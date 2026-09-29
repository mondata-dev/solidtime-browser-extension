import {
  isLinearIssuePage,
  getLinearIssueInfo,
  getIssueTitleFromDOM as getLinearTitleFromDOM,
  findPropertiesSidebar,
  waitForElement as waitForLinearElement,
  observeUrlChanges as observeLinearUrlChanges,
  injectTimeTrackingSection,
  removeTimeTrackingSection,
} from "./utils/linear";

import {
  isJiraIssuePage,
  getJiraIssueInfo,
  getIssueTitleFromDOM as getJiraTitleFromDOM,
  findJiraActionsWrapper,
  waitForElement as waitForJiraElement,
  observeJiraUrlChanges,
  observeJiraActionsWrapper,
  injectJiraTimeTrackingButton,
  removeJiraTimeTrackingButton,
} from "./utils/jira";

import {
  isPlaneIssuePage,
  getPlaneIssueInfo,
  getIssueTitleFromDOM as getPlaneTitleFromDOM,
  findPlaneActionsWrapper,
  waitForElement as waitForPlaneElement,
  observePlaneUrlChanges,
  observePlaneActionsWrapper,
  injectPlaneTimeTrackingButton,
  removePlaneTimeTrackingButton,
} from "./utils/plane";

import {
  isGitLabIssuePage,
  getGitLabIssueInfo,
  getIssueTitleFromDOM as getGitLabTitleFromDOM,
  findGitLabActionsWrapper,
  waitForElement as waitForGitLabElement,
  observeGitLabUrlChanges,
  observeGitLabActionsWrapper,
  injectGitLabTimeTrackingButton,
  removeGitLabTimeTrackingButton,
} from "./utils/gitlab";

import { isGitLabDomain } from "./utils/gitlabDomains";
import { storageLoaded } from "./utils/oauth";

export default defineContentScript({
  matches: [
    "*://linear.app/*",
    "*://app.linear.app/*",
    "*://*.atlassian.net/*",
    "*://app.plane.so/*",
    // Self-hosted GitLab domains are registered at runtime by the background script
    "*://gitlab.com/*",
  ],
  async main() {
    // Load the Solidtime instance settings and tokens before any API call
    await storageLoaded;

    // Determine which platform we're on
    const isLinear = window.location.hostname.includes("linear.app");
    const isJira = window.location.hostname.includes("atlassian.net");
    const isPlane = window.location.hostname.includes("plane.so");
    const isGitLab = await isGitLabDomain(window.location.hostname);

    if (isLinear) {
      initializeLinear();
    } else if (isJira) {
      initializeJira();
    } else if (isPlane) {
      initializePlane();
    } else if (isGitLab) {
      initializeGitLab();
    }
  },
});

// Linear integration
function initializeLinear() {
  // Function to inject time tracking if on a Linear issue page
  async function handlePageLoad() {
    // Check if we're on an issue page
    if (!isLinearIssuePage()) {
      removeTimeTrackingSection();
      return;
    }

    // Don't inject if already exists
    if (document.getElementById("solidtime-time-tracking-section")) {
      return;
    }

    try {
      // Wait for the properties sidebar to load
      const propertiesSidebar = await waitForLinearElement(
        findPropertiesSidebar,
        5000,
      );

      if (!propertiesSidebar) {
        return;
      }

      // Get issue information
      const issueInfo = getLinearIssueInfo();
      if (!issueInfo) {
        return;
      }

      // Get the issue title from DOM (more reliable than URL)
      const issueTitle =
        getLinearTitleFromDOM() || issueInfo.issueTitle || issueInfo.issueId;

      // Create issue description for time entry
      const issueDescription = `${issueInfo.issueId} ${issueTitle}`;

      // Inject the time tracking section
      await injectTimeTrackingSection(propertiesSidebar, issueDescription);
    } catch (error) {
      console.error(
        "Solidtime: Failed to inject time tracking section:",
        error,
      );
    }
  }

  // Initial load
  handlePageLoad();

  // Watch for URL changes (Linear is an SPA)
  observeLinearUrlChanges(() => {
    handlePageLoad();
  });
}

// Jira integration
function initializeJira() {
  // Keep track of the current observer
  let actionsWrapperObserver: MutationObserver | null = null;

  // Function to inject time tracking if on a Jira issue page
  async function handlePageLoad() {
    // Disconnect previous observer if it exists
    if (actionsWrapperObserver) {
      actionsWrapperObserver.disconnect();
      actionsWrapperObserver = null;
    }

    // Check if we're on an issue page
    if (!isJiraIssuePage()) {
      removeJiraTimeTrackingButton();
      return;
    }

    // Don't inject if already exists
    if (document.getElementById("solidtime-jira-button-wrapper")) {
      return;
    }

    try {
      // Wait for the actions wrapper to load
      const actionsWrapper = await waitForJiraElement(
        findJiraActionsWrapper,
        5000,
      );

      if (!actionsWrapper) {
        return;
      }

      // Get issue information
      const issueInfo = getJiraIssueInfo();
      if (!issueInfo) {
        return;
      }

      // Get the issue title from DOM (more reliable than just the issue key)
      const issueTitle = getJiraTitleFromDOM() || issueInfo.issueKey;

      // Create issue description for time entry
      const issueDescription = `${issueInfo.issueKey} ${issueTitle}`;

      // Inject the time tracking button
      await injectJiraTimeTrackingButton(actionsWrapper, issueDescription);

      // Set up observer to watch for DOM changes that might remove the button
      // This observes the entire document body to catch when the actions wrapper itself gets replaced
      actionsWrapperObserver = observeJiraActionsWrapper(issueDescription);
    } catch (error) {
      console.error(
        "Solidtime: Failed to inject Jira time tracking button:",
        error,
      );
    }
  }

  // Initial load
  handlePageLoad();

  // Watch for URL changes (Jira is an SPA)
  observeJiraUrlChanges(() => {
    handlePageLoad();
  });
}

// Plane integration
function initializePlane() {
  // Keep track of the current observer
  let actionsWrapperObserver: MutationObserver | null = null;

  // Function to inject time tracking if on a Plane issue page
  async function handlePageLoad() {
    // Disconnect previous observer if it exists
    if (actionsWrapperObserver) {
      actionsWrapperObserver.disconnect();
      actionsWrapperObserver = null;
    }

    // Check if we're on an issue page
    if (!isPlaneIssuePage()) {
      removePlaneTimeTrackingButton();
      return;
    }

    // Don't inject if already exists
    if (document.getElementById("solidtime-plane-tracking-btn")) {
      return;
    }

    try {
      // Wait for the actions wrapper to load
      const actionsWrapper = await waitForPlaneElement(
        findPlaneActionsWrapper,
        5000,
      );

      if (!actionsWrapper) {
        return;
      }

      // Get issue information
      const issueInfo = getPlaneIssueInfo();
      if (!issueInfo) {
        return;
      }

      // Get the issue title from DOM (more reliable than just the issue key)
      const issueTitle = getPlaneTitleFromDOM() || issueInfo.issueKey;

      // Create issue description for time entry
      const issueDescription = `${issueInfo.issueKey} ${issueTitle}`;

      // Inject the time tracking button
      await injectPlaneTimeTrackingButton(actionsWrapper, issueDescription);

      // Set up observer to watch for DOM changes that might remove the button
      actionsWrapperObserver = observePlaneActionsWrapper(issueDescription);
    } catch (error) {
      console.error(
        "Solidtime: Failed to inject Plane time tracking button:",
        error,
      );
    }
  }

  // Initial load
  handlePageLoad();

  // Watch for URL changes (Plane is an SPA)
  observePlaneUrlChanges(() => {
    handlePageLoad();
  });
}

// GitLab integration
function initializeGitLab() {
  // Keep track of the current observer
  let actionsWrapperObserver: MutationObserver | null = null;

  // Function to inject time tracking if a GitLab work item is shown
  async function handlePageLoad() {
    // Disconnect previous observer if it exists
    if (actionsWrapperObserver) {
      actionsWrapperObserver.disconnect();
      actionsWrapperObserver = null;
    }

    // The shown work item may have changed (full page -> side panel, or another issue in the panel)
    removeGitLabTimeTrackingButton();

    // Check if we're on a work item page or the side panel is open
    if (!isGitLabIssuePage()) {
      return;
    }

    try {
      // Wait for the sidebar to load (GitLab fetches work items via GraphQL after page load)
      const actionsWrapper = await waitForGitLabElement(
        findGitLabActionsWrapper,
        10000,
      );

      if (!actionsWrapper) {
        return;
      }

      // Get issue information
      const issueInfo = getGitLabIssueInfo();
      if (!issueInfo) {
        return;
      }

      // Get the issue title from DOM
      const issueTitle = getGitLabTitleFromDOM();

      // Create issue description for time entry (the repository becomes the Solidtime project)
      const issueDescription = issueTitle
        ? `#${issueInfo.iid} ${issueTitle}`
        : `#${issueInfo.iid}`;

      // Inject the time tracking section
      await injectGitLabTimeTrackingButton(
        actionsWrapper,
        issueInfo,
        issueDescription,
      );

      // Set up observer to watch for DOM changes that might remove the section
      actionsWrapperObserver = observeGitLabActionsWrapper(
        issueInfo,
        issueDescription,
      );
    } catch (error) {
      console.error(
        "Solidtime: Failed to inject GitLab time tracking button:",
        error,
      );
    }
  }

  // Initial load
  handlePageLoad();

  // Watch for URL changes (GitLab work items and the side panel are client-side routed)
  observeGitLabUrlChanges(() => {
    handlePageLoad();
  });
}
