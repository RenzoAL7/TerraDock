import {
  normalizeProject,
  type Directory,
  type FlociJob,
  type FlociStatus,
  type Preview,
  type Project,
  type Session,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let sessionToken = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { "X-TerraDock-Session": sessionToken } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ error: `Error ${response.status}` }))) as {
      error?: string;
    };
    throw new ApiError(
      body.error || "No se pudo completar la operación.",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

const projectRequest = async (path: string, init?: RequestInit) =>
  normalizeProject(await request<Project>(path, init));
export const api = {
  async session() {
    const session = await request<Session>("/session");
    sessionToken = session.token;
    return session;
  },
  project: () => projectRequest("/project"),
  demo: (template: string) =>
    projectRequest("/demo", {
      method: "POST",
      body: JSON.stringify({ template }),
    }),
  open: (path: string) =>
    projectRequest("/open", { method: "POST", body: JSON.stringify({ path }) }),
  directories: (path = "") =>
    request<Directory>(`/directories?path=${encodeURIComponent(path)}`),
  save: (
    projectId: string,
    path: string,
    content: string,
    expectedRevision: string,
  ) =>
    projectRequest("/files", {
      method: "PUT",
      body: JSON.stringify({ projectId, path, content, expectedRevision }),
    }),
  property: (
    projectId: string,
    resourceId: string,
    property: string,
    value: string | number | boolean,
    expectedRevision: string,
  ) =>
    projectRequest("/properties", {
      method: "PATCH",
      body: JSON.stringify({
        projectId,
        resourceId,
        property,
        value,
        expectedRevision,
      }),
    }),
};

export const liveApi = {
  analyze: (projectId: string, files: Record<string, string>) =>
    request<Preview>("/analyze", {
      method: "POST",
      body: JSON.stringify({ projectId, files }),
    }),
  editDraft: (
    projectId: string,
    path: string,
    content: string,
    resourceId: string,
    property: string,
    value: string | number | boolean,
  ) =>
    request<{ content: string }>("/edit-draft", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        path,
        content,
        resourceId,
        property,
        value,
      }),
    }),
};

export const flociApi = {
  status: () => request<FlociStatus>("/floci"),
  run: (
    action: FlociJob["action"],
    projectId: string,
    variables: Record<string, string> = {},
  ) =>
    request<FlociJob>("/floci/run", {
      method: "POST",
      body: JSON.stringify({ action, projectId, variables }),
    }),
  cancel: () =>
    request<{ canceled: boolean }>("/floci/cancel", {
      method: "POST",
      body: "{}",
    }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409)
    return "El archivo cambió mientras editabas. Conservamos tu borrador: revisa la versión actual antes de guardar.";
  return error instanceof Error
    ? error.message
    : "No se pudo completar la operación.";
}
