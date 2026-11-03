import type {
  AuthResponse,
  ProjectDto,
  RunRequest,
  RunResult,
  UserDto,
} from "@codelens/shared";

const TOKEN_KEY = "codelens.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // storage unavailable (private mode) — auth simply won't persist
  }
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;

  if (!response.ok) {
    throw new ApiRequestError(
      typeof body?.message === "string"
        ? body.message
        : `Request failed with status ${response.status}`,
      response.status,
      body?.details,
    );
  }

  return body as T;
}

export const api = {
  register(input: { email: string; name: string; password: string }): Promise<AuthResponse> {
    return request<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  login(input: { email: string; password: string }): Promise<AuthResponse> {
    return request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  me(): Promise<UserDto> {
    return request<UserDto>("/api/auth/me");
  },

  run(input: RunRequest): Promise<RunResult> {
    return request<RunResult>("/api/run", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  listProjects(): Promise<ProjectDto[]> {
    return request<ProjectDto[]>("/api/projects");
  },

  createProject(input: { name: string; sourceCode?: string }): Promise<ProjectDto> {
    return request<ProjectDto>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  getProject(id: string): Promise<ProjectDto> {
    return request<ProjectDto>(`/api/projects/${id}`);
  },

  updateProject(id: string, input: { name?: string; sourceCode?: string }): Promise<ProjectDto> {
    return request<ProjectDto>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  deleteProject(id: string): Promise<void> {
    return request<void>(`/api/projects/${id}`, { method: "DELETE" });
  },
};
