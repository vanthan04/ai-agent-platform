export interface Issue {
  path: string;
  message: string;
}

/** A failed call. `status` is the HTTP status, or 0 when the server could not be reached at all. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const FALLBACK: Record<number, string> = {
  400: "The request was not accepted. Check the fields and try again.",
  401: "You are not signed in.",
  403: "You do not have permission to do this.",
  404: "Not found.",
  409: "This conflicts with the current state. Reload and try again.",
  422: "The request was understood but cannot be done as asked.",
  429: "Too many requests. Wait a moment and try again.",
  502: "The server could not be reached.",
  503: "This feature is not available on the server right now.",
};

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Calls the backend through this app's `/api` proxy and returns the parsed JSON, or `undefined` for 204. */
export async function api<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: { accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Cannot reach the server. Check that it is running.");
  }
  if (response.status === 204) return undefined as T;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const body = (data ?? {}) as { message?: unknown; issues?: unknown };
    const message = typeof body.message === "string" && body.message !== "invalid request" ? body.message : (FALLBACK[response.status] ?? `The server answered ${response.status}.`);
    const issues = Array.isArray(body.issues)
      ? body.issues.flatMap((item: unknown) => {
          const issue = item as { path?: unknown; message?: unknown };
          return typeof issue.message === "string" ? [{ path: typeof issue.path === "string" ? issue.path : "", message: issue.message }] : [];
        })
      : [];
    throw new ApiError(response.status, message, issues);
  }
  return data as T;
}

export const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

/** A short text for an error, with the field problems the server listed, for showing next to a form. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message));
    return details.length > 0 ? `${error.message} ${details.join("; ")}` : error.message;
  }
  return "Something went wrong.";
}
