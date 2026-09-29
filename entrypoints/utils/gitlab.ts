/**
 * GitLab-specific utilities for detecting work item pages and extracting issue information
 */

import { apiClient } from "./api";
import { getCurrentTimeEntry } from "./timeEntries";
import type { CreateTimeEntryBody } from "@solidtime/api";
import { accessToken } from "./oauth";
import { dayjs } from "./dayjs";
import { findOrCreateProject, findOrCreateTask } from "./projectTasks";

export interface GitLabIssueInfo {
  iid: string;
  // Repository (project path) name, used as the Solidtime project name
  projectName: string;
  fullUrl: string;
}

const SECTION_ID = "solidtime-gitlab-section";
const BUTTON_ID = "solidtime-gitlab-tracking-btn";

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
      alert("Please log in to Solidtime first by clicking the extension icon");
      return;
    }

    const client = apiClient();
    // Shown after the timer started, so the alert doesn't delay it
    let notice: string | null = null;

    if (isCurrentlyTracking) {
      // Stop current time entry
      const currentEntry = await getCurrentTimeEntry();
      if (currentEntry?.data?.id) {
        await client.updateTimeEntry(
          {
            ...currentEntry.data,
            end: dayjs.utc().format(),
          },
          {
            params: {
              organization: currentEntry.data.organization_id,
              timeEntry: currentEntry.data.id,
            },
          },
        );
      }
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
        alert("Please select an organization in the Solidtime extension first");
        return;
      }

      // Associate the time entry with the repository's project and the issue's task.
      // If either can't be found or created, still start the timer and tell the user.
      let projectId: string | null = null;
      let taskId: string | null = null;
      let billable = false;
      try {
        const project = await findOrCreateProject(
          organizationId,
          issueInfo.projectName,
        );
        projectId = project.id;
        billable = project.is_billable;

        const taskPrefix = `#${issueInfo.iid}`;
        const task = await findOrCreateTask(
          organizationId,
          project.id,
          issueDescription,
          (task) =>
            task.name === taskPrefix || task.name.startsWith(`${taskPrefix} `),
        );
        taskId = task.id;
      } catch (error) {
        console.error(
          "Solidtime: Failed to find or create project/task:",
          error,
        );
        const missing = projectId
          ? "a task"
          : `the project "${issueInfo.projectName}"`;
        notice = `The timer was started without ${missing}, because it could not be found or created in Solidtime: ${getApiErrorMessage(error)}`;
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
      alert(notice);
    }
  } catch (error) {
    console.error("Failed to toggle time tracking:", error);
    alert(
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
