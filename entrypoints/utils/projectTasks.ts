/**
 * Finds the Solidtime project and task that an issue's time entries belong to
 */

import type { Project, Task } from "@solidtime/api";
import { apiClient } from "./api";

/**
 * Finds the project with the given name, or returns null if there is none.
 * An exact name match wins over a case-insensitive one.
 */
export async function findProject(
  organizationId: string,
  name: string,
): Promise<Project | null> {
  const client = apiClient();
  let caseInsensitiveMatch: Project | undefined;

  // Projects are paginated, so look through all pages
  for (let page = 1; ; page++) {
    const response = await client.getProjects({
      params: { organization: organizationId },
      queries: { page },
    });

    const exactMatch = response.data.find((project) => project.name === name);
    if (exactMatch) {
      return exactMatch;
    }

    caseInsensitiveMatch ??= response.data.find(
      (project) => project.name.toLowerCase() === name.toLowerCase(),
    );

    if (page >= response.meta.last_page) {
      break;
    }
  }

  return caseInsensitiveMatch ?? null;
}

/**
 * Finds the first task in the project for which isMatch returns true, or creates one with the given name
 */
export async function findOrCreateTask(
  organizationId: string,
  projectId: string,
  name: string,
  isMatch: (task: Task) => boolean,
): Promise<Task> {
  const client = apiClient();

  // Tasks are paginated (newest first), so look through all pages
  for (let page = 1; ; page++) {
    // The API client doesn't declare "page" for tasks, but passes it on to the endpoint
    const queries = { project_id: projectId, done: "all" as const, page };
    const response = await client.getTasks({
      params: { organization: organizationId },
      queries,
    });

    const task = response.data.find(isMatch);
    if (task) {
      return task;
    }

    if (page >= response.meta.last_page) {
      break;
    }
  }

  const response = await client.createTask(
    { name: name.slice(0, 255), project_id: projectId },
    { params: { organization: organizationId } },
  );

  return response.data;
}
