import { z } from "zod";
import { isPublicHttpsUrl } from "../../shared-kernel";
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

export const McpServerUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isPublicHttpsUrl, "must be an https address of a public server, with no IP address, credentials or query")
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
