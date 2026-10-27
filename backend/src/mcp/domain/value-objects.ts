import { z } from "zod";
import { id } from "./ids";

export const McpConnectionId = id<"McpConnectionId">();
export type McpConnectionId = z.infer<typeof McpConnectionId>;

/** Names of the tools of this connection in the project policy are written `<name>:<tool>`, so the name has no colon. */
export const McpConnectionName = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,31}$/, "use lower-case letters, digits and dashes, starting with a letter (at most 32)")
  .brand<"McpConnectionName">();
export type McpConnectionName = z.infer<typeof McpConnectionName>;

const PRIVATE_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet", ".private"];

/**
 * A remote MCP server (D11): https, a public DNS name, no credentials and no query in the address. IP addresses and
 * single-label names such as `localhost` are refused, which also rules out the private and link-local ranges.
 * This is a first line only: a name can still resolve to a private address, so the call itself must check where it connects.
 */
function isAcceptableMcpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return false;
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return false;
  if (!/^[a-z][a-z0-9-]*$/.test(host.split(".").at(-1) ?? "")) return false;
  return !PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export const McpServerUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isAcceptableMcpUrl, "must be an https address of a public server, with no IP address, credentials or query")
  .brand<"McpServerUrl">();
export type McpServerUrl = z.infer<typeof McpServerUrl>;

/** A bearer token: printable characters without spaces, so it can never break out of an HTTP header. Never echoed, never logged. */
export const BearerToken = z
  .string()
  .min(8)
  .max(4_096)
  .regex(/^[\x21-\x7E]+$/, "must be printable characters without spaces")
  .brand<"BearerToken">();
export type BearerToken = z.infer<typeof BearerToken>;
