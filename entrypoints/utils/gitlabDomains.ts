/**
 * Self-hosted GitLab domains the content script is registered on.
 * gitlab.com is always covered by the content script's manifest matches.
 */

export const GITLAB_DOMAINS_KEY = "gitlab_domains";

/**
 * Parses user input like "https://gitlab.example.com/, git.company.org:8443" into plain hostnames
 */
export function parseGitLabDomains(input: string): string[] {
  const domains = input
    .split(/[\s,]+/)
    .map((entry) =>
      entry
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, "")
        .replace(/[/?#].*$/, "")
        .replace(/:\d+$/, ""),
    )
    .filter(
      (domain) =>
        /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(domain) && domain !== "gitlab.com",
    );

  return [...new Set(domains)];
}

/**
 * Stored in browser.storage so the background script and content scripts can read it
 */
export async function getGitLabDomains(): Promise<string[]> {
  const result = await browser.storage.local.get<{
    gitlab_domains?: string[];
  }>([GITLAB_DOMAINS_KEY]);
  return result.gitlab_domains || [];
}

export async function setGitLabDomains(domains: string[]): Promise<void> {
  await browser.storage.local.set({ [GITLAB_DOMAINS_KEY]: domains });
}

/**
 * Checks if the given hostname is gitlab.com or one of the configured self-hosted domains
 */
export async function isGitLabDomain(hostname: string): Promise<boolean> {
  return (
    hostname === "gitlab.com" || (await getGitLabDomains()).includes(hostname)
  );
}
