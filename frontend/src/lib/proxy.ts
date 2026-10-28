/**
 * The browser never talks to the backend directly. It calls `/api/...` on this app, and this module forwards the call. That
 * keeps the backend address out of the browser, avoids cross-origin rules, and gives one place that decides what may pass:
 * only the project routes and the health check, only the usual methods, only a few request headers, a bounded body, a
 * deadline, and no redirects. The backend stays the authority on who may do what; nothing here grants anything.
 */

const ALLOWED_ROOTS = new Set(["projects", "health"]);
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "idempotency-key", "x-correlation-id"];
const MAX_BODY_BYTES = 1_000_000;
const TIMEOUT_MS = 30_000;

export function backendBase(env: Record<string, string | undefined> = process.env): string {
  const value = env["BACKEND_URL"] ?? "http://127.0.0.1:3001";
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("BACKEND_URL must be an http or https address");
  return url.origin;
}

/** The backend URL for a path, or `undefined` when the path may not be forwarded. Segments arrive already decoded. */
export function targetFor(segments: readonly string[], search: string, base: string): URL | undefined {
  const [root] = segments;
  if (root === undefined || !ALLOWED_ROOTS.has(root)) return undefined;
  // A decoded segment that is empty, a dot, or holds a slash, backslash or control character could climb out of the route.
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || /[\\/\u0000-\u001f]/.test(segment))) return undefined;
  const target = new URL(`${base}/${segments.map(encodeURIComponent).join("/")}${search}`);
  return target.origin === base ? target : undefined;
}

const json = (status: number, message: string): Response =>
  new Response(JSON.stringify({ statusCode: status, message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function forward(
  request: Request,
  segments: readonly string[],
  options: { fetchImpl?: typeof fetch; base?: string } = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!ALLOWED_METHODS.has(request.method)) return json(405, "method not allowed");
  const target = targetFor(segments, new URL(request.url).search, options.base ?? backendBase());
  if (!target) return json(404, "not found");

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "DELETE") {
    body = await request.text();
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return json(413, "request body too large");
  }

  let upstream: Response;
  try {
    upstream = await fetchImpl(target, { method: request.method, headers, body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return json(502, "the server could not be reached");
  }
  // A redirect would send the caller somewhere it did not ask for, so it is reported as a bad gateway.
  if (upstream.status >= 300 && upstream.status < 400) return json(502, "unexpected answer from the server");

  const responseHeaders = new Headers({ "cache-control": "no-store" });
  const type = upstream.headers.get("content-type");
  if (type !== null) responseHeaders.set("content-type", type);
  return new Response(upstream.status === 204 || upstream.status === 205 ? null : await upstream.text(), { status: upstream.status, headers: responseHeaders });
}
