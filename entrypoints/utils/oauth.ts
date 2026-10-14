import { computed, ref } from "vue";

export const DEFAULT_ENDPOINT = "https://app.solidtime.io";
export const DEFAULT_CLIENT_ID = "019b27e8-a52a-71d8-8d67-071cff97f315";

// Use chrome.storage for instance settings and tokens (survives popup closing).
// localStorage can't be used here: in content scripts it belongs to the host page.
export const endpoint = ref(DEFAULT_ENDPOINT);
export const clientId = ref(DEFAULT_CLIENT_ID);
export const accessToken = ref("");
export const refreshToken = ref("");

type StoredSettings = {
  instance_endpoint?: string;
  instance_client_id?: string;
  access_token?: string;
  refresh_token?: string;
};

const INSTANCE_SETTING_KEYS = ["instance_endpoint", "instance_client_id"] as const;

// Instance settings used to be stored in the popup's localStorage
async function migrateLocalStorageSettings(result: StoredSettings) {
  if (!location.protocol.endsWith("-extension:")) {
    return;
  }

  for (const key of INSTANCE_SETTING_KEYS) {
    const legacyValue = localStorage.getItem(key);
    if (!result[key] && legacyValue) {
      result[key] = legacyValue;
      await browser.storage.local.set({ [key]: legacyValue });
      localStorage.removeItem(key);
    }
  }
}

// Load instance settings and tokens from chrome.storage on init
async function loadStoredSettings() {
  const result = await browser.storage.local.get<StoredSettings>([
    ...INSTANCE_SETTING_KEYS,
    "access_token",
    "refresh_token",
  ]);
  await migrateLocalStorageSettings(result);

  // Set the instance before the tokens, so requests gated on isLoggedIn use the right endpoint
  endpoint.value = result.instance_endpoint || DEFAULT_ENDPOINT;
  clientId.value = result.instance_client_id || DEFAULT_CLIENT_ID;
  accessToken.value = result.access_token || "";
  refreshToken.value = result.refresh_token || "";
}

// Watch for storage changes (from background script)
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.instance_endpoint) {
      endpoint.value =
        (changes.instance_endpoint.newValue as string) || DEFAULT_ENDPOINT;
    }
    if (changes.instance_client_id) {
      clientId.value =
        (changes.instance_client_id.newValue as string) || DEFAULT_CLIENT_ID;
    }
    if (changes.access_token) {
      accessToken.value = changes.access_token.newValue || "";
    }
    if (changes.refresh_token) {
      refreshToken.value = changes.refresh_token.newValue || "";
    }
  }
});

// Initialize (await this before making API calls outside the popup)
export const storageLoaded = loadStoredSettings();

// Use browser.identity.getRedirectURL() which works for both Firefox and Chrome
export const getRedirectUrl = () => browser.identity.getRedirectURL();

export const isLoggedIn = computed(() => !!accessToken.value);

let refreshPromise: Promise<void> | null = null;

export async function refreshAccessToken(): Promise<void> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const currentRefreshToken = refreshToken.value;
  if (!currentRefreshToken) {
    accessToken.value = "";
    refreshToken.value = "";
    await browser.storage.local.remove(["access_token", "refresh_token"]);
    throw new Error("No refresh token available - user logged out");
  }

  refreshPromise = (async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: "REFRESH_TOKEN",
        payload: {
          endpoint: endpoint.value,
          clientId: clientId.value,
          refreshToken: currentRefreshToken,
        },
      });

      if (!response.success) {
        throw new Error(response.error || "Failed to refresh token");
      }

      // Update tokens
      await browser.storage.local.set({
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
      });

      accessToken.value = response.data.access_token;
      refreshToken.value = response.data.refresh_token;
    } catch (error) {
      accessToken.value = "";
      refreshToken.value = "";
      await browser.storage.local.remove(["access_token", "refresh_token"]);
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function startOAuthFlow(): Promise<void> {
  return new Promise((resolve, reject) => {
    browser.runtime.sendMessage(
      {
        type: "START_OAUTH_FLOW",
        payload: {
          endpoint: endpoint.value,
          clientId: clientId.value,
        },
      },
      (response) => {
        if (browser.runtime.lastError) {
          reject(new Error(browser.runtime.lastError.message));
          return;
        }

        if (!response.success) {
          reject(new Error(response.error || "OAuth failed"));
          return;
        }

        resolve();
      },
    );
  });
}

export async function saveInstanceSettings(
  newEndpoint: string,
  newClientId: string,
): Promise<void> {
  endpoint.value = newEndpoint;
  clientId.value = newClientId;
  await browser.storage.local.set({
    instance_endpoint: newEndpoint,
    instance_client_id: newClientId,
  });
}

export async function logout() {
  accessToken.value = "";
  refreshToken.value = "";
  await browser.storage.local.remove(["access_token", "refresh_token"]);
}
