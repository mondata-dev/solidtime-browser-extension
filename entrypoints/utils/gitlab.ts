/**
 * GitLab-specific utilities for detecting work item pages and extracting issue information
 */

import { apiClient } from "./api";
import { getCurrentTimeEntry } from "./timeEntries";
import type { CreateTimeEntryBody, TimeEntry } from "@solidtime/api";
import { accessToken } from "./oauth";
import { dayjs } from "./dayjs";
import { findOrCreateTask, findProject } from "./projectTasks";

export interface GitLabIssueInfo {
  iid: string;
  // Repository (project path) name, used as the Solidtime project name
  projectName: string;
  fullUrl: string;
}

const SECTION_ID = "solidtime-gitlab-section";
const BUTTON_ID = "solidtime-gitlab-tracking-btn";
const MESSAGE_ID = "solidtime-gitlab-message";

// The issue the section was last injected for, used to refresh it in place
let injectedIssue: {
  issueInfo: GitLabIssueInfo;
  issueDescription: string;
} | null = null;
let refreshInProgress: Promise<void> | null = null;

/**
 * Checks if a work item is opened in the side panel (from issue lists and boards)
 */
function isSidePanelOpen(): boolean {
  return new URLSearchParams(window.location.search).has("show");
}

/**
 * Finds the element containing the currently shown work item:
 * the side panel if it is open, otherwise the full work item page
 */
function findWorkItemRoot(): HTMLElement | null {
  if (isSidePanelOpen()) {
    return document.querySelector<HTMLElement>(
      '[data-testid="work-item-detail-panel"]',
    );
  }

  return document.querySelector<HTMLElement>('[data-testid="work-item-detail"]');
}

/**
 * Extracts repository name and issue iid from an issue path, e.g. "/group/project/-/work_items/42"
 */
function parseIssuePath(
  path: string,
): Pick<GitLabIssueInfo, "iid" | "projectName"> | null {
  // The side panel link can still point at /-/issues/N on some GitLab versions
  const match = path.match(/^(.*)\/-\/(?:issues|work_items)\/(\d+)(?:\/|$)/);

  // Skip group-level work items such as epics
  if (!match || match[1].startsWith("/groups/")) {
    return null;
  }

  const [, projectPath, iid] = match;
  const projectName = decodeURIComponent(projectPath.split("/").pop() || "");

  return projectName ? { iid, projectName } : null;
}

/**
 * Checks if the current page shows a GitLab work item (full page or side panel)
 */
export function isGitLabIssuePage(): boolean {
  // GitLab work item URLs follow two patterns:
  // 1. https://gitlab.com/{group}/{project}/-/work_items/{iid}
  // 2. Any issue list or board with ?show={encoded work item} for the side panel
  return (
    isSidePanelOpen() ||
    /\/-\/work_items\/\d+(?:\/|$)/.test(window.location.pathname)
  );
}

/**
 * Extracts issue information from the currently shown GitLab work item
 */
export function getGitLabIssueInfo(): GitLabIssueInfo | null {
  if (!isGitLabIssuePage()) {
    return null;
  }

  if (isSidePanelOpen()) {
    // The panel header links to the work item that is currently shown
    const refLink = document.querySelector<HTMLAnchorElement>(
      '[data-testid="work-item-detail-panel"] [data-testid="work-item-detail-panel-ref-link"]',
    );
    const issue = refLink ? parseIssuePath(refLink.pathname) : null;

    return refLink && issue ? { ...issue, fullUrl: refLink.href } : null;
  }

  const issue = parseIssuePath(window.location.pathname);

  return issue ? { ...issue, fullUrl: window.location.href } : null;
}

/**
 * Gets the work item title from the DOM
 */
export function getIssueTitleFromDOM(): string | null {
  const titleElement = findWorkItemRoot()?.querySelector(
    '[data-testid="work-item-title"]',
  );

  return titleElement?.textContent?.trim() || null;
}

/**
 * Finds GitLab's own "Time tracking" widget in the sidebar, we inject the Time Tracking section after it.
 * The sidebar wrapper itself renders before its widgets, so we wait for the widget.
 */
export function findGitLabActionsWrapper(): HTMLElement | null {
  return (
    findWorkItemRoot()?.querySelector<HTMLElement>(
      '[data-testid="work-item-time-tracking"]',
    ) || null
  );
}

/**
 * Creates the Time Tracking section using GitLab's own (Pajamas) classes
 */
function createGitLabTimeTrackingSection(isTracking: boolean): HTMLElement {
  const section = document.createElement("div");
  section.id = SECTION_ID;
  section.className = "work-item-attributes-item";

  const heading = document.createElement("h3");
  heading.className = "gl-heading-5 !gl-mb-2";
  heading.textContent = "Solidtime";

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = "btn gl-button btn-default btn-sm";

  // Create SVG icon (play/stop)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "gl-button-icon gl-icon s16");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", isTracking ? "#DE350B" : "currentColor");

  if (isTracking) {
    // Stop icon (square)
    path.setAttribute(
      "d",
      "M4 3C3.44772 3 3 3.44772 3 4V12C3 12.5523 3.44772 13 4 13H12C12.5523 13 13 12.5523 13 12V4C13 3.44772 12.5523 3 12 3H4Z",
    );
  } else {
    // Play icon (triangle)
    path.setAttribute(
      "d",
      "M5.5 3.5C5.5 2.67157 6.42157 2.17157 7.08579 2.58579L12.5858 6.08579C13.1716 6.45098 13.1716 7.54902 12.5858 7.91421L7.08579 11.4142C6.42157 11.8284 5.5 11.3284 5.5 10.5V3.5Z",
    );
  }

  svg.appendChild(path);

  // Create text span
  const textSpan = document.createElement("span");
  textSpan.className = "gl-button-text";
  textSpan.textContent = isTracking ? "Stop Timer" : "Start Timer";

  // Assemble the structure
  button.appendChild(svg);
  button.appendChild(textSpan);
  section.appendChild(heading);
  section.appendChild(button);

  return section;
}

/**
 * Injects the Time Tracking section after GitLab's "Time tracking" widget
 */
export async function injectGitLabTimeTrackingButton(
  timeTrackingWidget: HTMLElement,
  issueInfo: GitLabIssueInfo,
  issueDescription: string,
  skipExistingCheck = false,
): Promise<void> {
  // Check if section already exists and skip if so (unless explicitly told to replace)
  if (document.getElementById(SECTION_ID) && !skipExistingCheck) {
    return;
  }

  // Check if there's a current time entry
  let isTracking = false;
  try {
    if (accessToken.value) {
      const currentEntry = await getCurrentTimeEntry();
      isTracking = currentEntry?.data?.id ? true : false;
    }
  } catch (error) {
    console.error("Failed to get current time entry:", error);
  }

  // Check again, another call may have injected the section while we were waiting
  const existingSection = document.getElementById(SECTION_ID);
  if (existingSection && !skipExistingCheck) {
    return;
  }

  // Remove existing section if present
  if (existingSection) {
    existingSection.remove();
  }

  // Create the section and insert it right after GitLab's own "Time tracking" widget
  const section = createGitLabTimeTrackingSection(isTracking);
  timeTrackingWidget.after(section);
  injectedIssue = { issueInfo, issueDescription };

  // Add click handler
  const button = document.getElementById(BUTTON_ID);
  if (button) {
    button.addEventListener("click", () =>
      handleGitLabTrackingClick(issueInfo, issueDescription, isTracking),
    );
  }
}

/**
 * Handles the Start/Stop Tracking button click
 */
async function handleGitLabTrackingClick(
  issueInfo: GitLabIssueInfo,
  issueDescription: string,
  isCurrentlyTracking: boolean,
): Promise<void> {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;

  // Disable button during API call
  button.setAttribute("disabled", "true");
  button.style.opacity = "0.5";
  button.style.cursor = "not-allowed";

  try {
    if (!accessToken.value) {
      showGitLabMessage(
        "Please log in to Solidtime first by clicking the extension icon",
      );
      return;
    }

    const client = apiClient();
    // Shown after the timer started, so the refreshed section doesn't remove it
    let notice: string | null = null;

    // The timer may have been started or stopped elsewhere since the button was rendered
    // (extension popup, Solidtime web app, another device)
    const runningEntry = await getRunningTimeEntry();
    if (!!runningEntry !== isCurrentlyTracking) {
      // Only correct the button, so an outdated button never starts or stops a timer
      await refreshGitLabTimeTrackingButton();
      return;
    }

    if (runningEntry) {
      // Stop current time entry
      await client.updateTimeEntry(
        {
          ...runningEntry,
          end: dayjs.utc().format(),
        },
        {
          params: {
            organization: runningEntry.organization_id,
            timeEntry: runningEntry.id,
          },
        },
      );
    } else {
      // Start new time entry at the time of the click (finding the project and task takes a moment)
      const start = dayjs.utc().format();
      const storage = await browser.storage.local.get<{
        current_organization_id?: string;
        currentMembershipId?: string;
      }>(["current_organization_id", "currentMembershipId"]);
      const organizationId = storage.current_organization_id;
      const membershipId = storage.currentMembershipId;

      if (!organizationId || !membershipId) {
        showGitLabMessage(
          "Please select an organization in the Solidtime extension first",
        );
        return;
      }

      // Associate the time entry with the repository's project and the issue's task.
      // Projects are never created, so without a matching project (or if the task can't
      // be found or created) still start the timer and tell the user.
      let projectId: string | null = null;
      let taskId: string | null = null;
      let billable = false;
      try {
        const project = await findProject(
          organizationId,
          issueInfo.projectName,
        );

        if (project) {
          projectId = project.id;
          billable = project.is_billable;

          const taskPrefix = `#${issueInfo.iid}`;
          const task = await findOrCreateTask(
            organizationId,
            project.id,
            issueDescription,
            (task) =>
              task.name === taskPrefix ||
              task.name.startsWith(`${taskPrefix} `),
          );
          taskId = task.id;
        } else {
          notice = `The timer was started without a project, because there is no Solidtime project named "${issueInfo.projectName}". You can set the project in the Solidtime extension.`;
        }
      } catch (error) {
        console.error("Solidtime: Failed to find project/task:", error);
        notice = projectId
          ? `The timer was started without a task, because it could not be found or created in Solidtime: ${getApiErrorMessage(error)}`
          : `The timer was started without a project, because the projects could not be loaded from Solidtime: ${getApiErrorMessage(error)}`;
      }

      const timeEntryData: CreateTimeEntryBody = {
        member_id: membershipId,
        project_id: projectId,
        task_id: taskId,
        description: issueDescription,
        start,
        billable,
      };

      await client.createTimeEntry(timeEntryData, {
        params: {
          organization: organizationId,
        },
      });
    }

    // Refresh the section
    const timeTrackingWidget = findGitLabActionsWrapper();
    if (timeTrackingWidget) {
      await injectGitLabTimeTrackingButton(
        timeTrackingWidget,
        issueInfo,
        issueDescription,
        true,
      );
    }

    if (notice) {
      showGitLabMessage(notice);
    }
  } catch (error) {
    console.error("Failed to toggle time tracking:", error);
    showGitLabMessage(
      "Failed to toggle time tracking. Please make sure you are logged in.",
    );
  } finally {
    // Re-enable button
    if (button) {
      button.removeAttribute("disabled");
      button.style.opacity = "1";
      button.style.cursor = "pointer";
    }
  }
}

/**
 * Shows a red message below the button, until the section is rendered again
 */
function showGitLabMessage(message: string): void {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  let messageElement = document.getElementById(MESSAGE_ID);
  if (!messageElement) {
    messageElement = document.createElement("p");
    messageElement.id = MESSAGE_ID;
    messageElement.className = "gl-mb-0 gl-mt-2 gl-text-sm";
    messageElement.style.color = "var(--gl-text-color-danger, #DE350B)";
    messageElement.setAttribute("role", "alert");
    section.appendChild(messageElement);
  }

  messageElement.textContent = message;
}

/**
 * Gets the user's running time entry, or null if no timer is running
 */
async function getRunningTimeEntry(): Promise<TimeEntry | null> {
  try {
    const response = await getCurrentTimeEntry();
    return response?.data?.id ? response.data : null;
  } catch (error) {
    // The API responds with 404 when no timer is running
    if ((error as { response?: { status?: number } })?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Gets a readable message from a failed API request (e.g. missing permission or validation error)
 */
function getApiErrorMessage(error: unknown): string {
  const response = (error as { response?: { data?: { message?: string } } })
    ?.response;
  return (
    response?.data?.message ||
    (error instanceof Error ? error.message : "Unknown error")
  );
}

/**
 * Re-reads the running timer from the API and updates the injected section in place.
 * Overlapping calls (e.g. focus and visibilitychange on a tab switch) share one request.
 */
export function refreshGitLabTimeTrackingButton(): Promise<void> {
  refreshInProgress ??= (async () => {
    const timeTrackingWidget = findGitLabActionsWrapper();
    if (
      !injectedIssue ||
      !timeTrackingWidget ||
      !document.getElementById(SECTION_ID)
    ) {
      return;
    }

    await injectGitLabTimeTrackingButton(
      timeTrackingWidget,
      injectedIssue.issueInfo,
      injectedIssue.issueDescription,
      true,
    );
  })().finally(() => {
    refreshInProgress = null;
  });

  return refreshInProgress;
}

/**
 * Calls the callback when the user comes back to the page: when the tab becomes visible
 * again, or the window gets focus back (e.g. after closing the extension popup)
 */
export function observeGitLabPageFocus(callback: () => void): void {
  window.addEventListener("focus", callback);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      callback();
    }
  });
}

/**
 * Removes the Time Tracking section
 */
export function removeGitLabTimeTrackingButton(): void {
  const section = document.getElementById(SECTION_ID);
  if (section) {
    section.remove();
  }
}

/**
 * Waits for an element to appear in the DOM
 */
export function waitForElement(
  selector: string | (() => HTMLElement | null),
  timeout = 5000,
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      const element =
        typeof selector === "function"
          ? selector()
          : document.querySelector<HTMLElement>(selector);

      if (element) {
        resolve(element);
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error("Element not found within timeout"));
        return;
      }

      requestAnimationFrame(check);
    };

    check();
  });
}

/**
 * Creates a URL observer to watch for work item changes (including the side panel)
 */
export function observeGitLabUrlChanges(callback: () => void): void {
  let lastUrl = window.location.href;

  const observer = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      callback();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also listen to popstate for browser back/forward
  window.addEventListener("popstate", callback);
}

/**
 * Observes the DOM for changes and re-injects the section if GitLab re-renders it away
 * Uses a throttled approach to minimize performance impact
 */
export function observeGitLabActionsWrapper(
  issueInfo: GitLabIssueInfo,
  issueDescription: string,
): MutationObserver {
  const observedUrl = window.location.href;
  let isReinjecting = false;
  let checkScheduled = false;

  const checkAndReinject = async () => {
    checkScheduled = false;

    // After a URL change the page load handler injects the section for the new work item
    if (isReinjecting || window.location.href !== observedUrl) {
      return;
    }

    const sectionExists = document.getElementById(SECTION_ID);

    if (!sectionExists && isGitLabIssuePage()) {
      isReinjecting = true;

      try {
        const timeTrackingWidget = findGitLabActionsWrapper();

        if (timeTrackingWidget) {
          await injectGitLabTimeTrackingButton(
            timeTrackingWidget,
            issueInfo,
            issueDescription,
          );
        }
      } catch (error) {
        console.error("Solidtime: Failed to re-inject button:", error);
      } finally {
        setTimeout(() => {
          isReinjecting = false;
        }, 100);
      }
    }
  };

  const observer = new MutationObserver(() => {
    if (!checkScheduled) {
      checkScheduled = true;
      requestAnimationFrame(checkAndReinject);
    }
  });

  // Observe the whole body, the side panel is mounted outside the main layout
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return observer;
}
