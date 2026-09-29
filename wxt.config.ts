import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
// Pins the Chrome extension ID (pgmlmakhoidmghbhkdmbpoobjcckmalp) across
// unpacked reloads, so OAuth redirect URIs stay valid. Chrome derives the ID
// from this public key instead of the unpacked folder path.
const CHROME_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2Q6FTZgzye75Zve2EvI/CeiS6nIgn3q/Mz+5cnMJ18b0+m+85R1/TTaboghi5wOTD1qom6FQh1l/b+JozejmSkSd4ZpKyhdyyXhvVIWhEZ3Med/a1L5U1+Hg0Emr1CWTSejtJNfWLRgzvvZGKKqnUFzcAuJcbVmjaKEw86VE3bfUj1Qp2JYJVM4DeCfTis8wnQYrbRePrbgowZbVQQ69ccukmuJ0NM+vbslf9ezhKfHptMFhMKTDPd/26B+IzFh0YP45NpZlpKuJC9SnWdWsFKwp4BKtligkYEwD5uK5PokcW9Fq5kodHsYAPvtd+z0AD6MJkXNYx4xzCdGhk4bzMQIDAQAB";

export default defineConfig({
  modules: ["@wxt-dev/module-vue"],
  manifest: ({ browser }) => ({
    permissions: ["storage", "identity"],
    host_permissions: ["<all_urls>"],
    name: "Solidtime",
    description:
      "Browser extension for Solidtime - the modern open-source time tracker",
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    ...(browser === "chrome" ? { key: CHROME_PUBLIC_KEY } : {}),
    browser_specific_settings: {
      gecko: {
        id: "solidtime@mondata.de",
        data_collection_permissions: {
          required: [
            "personallyIdentifyingInfo",
            "authenticationInfo",
            "websiteContent",
          ],
          optional: ["technicalAndInteraction"],
        },
      },
    },
  }),
  webExt: {
    disabled: false,
  },
});
