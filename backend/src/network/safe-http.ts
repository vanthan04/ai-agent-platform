import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { isPublicAddress } from "./public-address";
import { BlockedAddressError, createSafeLookup } from "./safe-lookup";

export type OutboundFailure = "blocked_address" | "unreachable" | "timeout" | "response_too_large" | "invalid_request";

export class OutboundError extends Error {
  constructor(readonly failure: OutboundFailure) {
    super(failure);
  }
}

export interface OutboundRequest {
  url: string;
  method: "GET" | "POST" | "DELETE";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface OutboundResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * The only way this server calls a URL a user supplied. It speaks https, connects only to public addresses (checked on the
 * address actually used), never follows a redirect (so a token cannot be passed on to another host), sends no cookies or
 * compression, and stops at a deadline and a size limit. A request that fails says why in one word and never repeats
 * anything the remote side sent.
 *
 * The constructor options exist for tests, which talk to a plain-http server on this machine. Nothing in the app sets them.
 */
export class SafeHttpClient {
  private readonly protocol: "https:" | "http:";
  private readonly allowNonPublic: boolean;
  private readonly transport: typeof https.request;
  private readonly lookup: ReturnType<typeof createSafeLookup>;

  constructor(options: { protocol?: "https:" | "http:"; allowNonPublic?: boolean; request?: typeof https.request; lookup?: ReturnType<typeof createSafeLookup> } = {}) {
    this.protocol = options.protocol ?? "https:";
    this.allowNonPublic = options.allowNonPublic ?? false;
    this.transport = options.request ?? (this.protocol === "https:" ? https.request : (http.request as unknown as typeof https.request));
    this.lookup = options.lookup ?? createSafeLookup({ allowNonPublic: this.allowNonPublic });
  }

  send(input: OutboundRequest): Promise<OutboundResponse> {
    let target: URL;
    try {
      target = new URL(input.url);
    } catch {
      return Promise.reject(new OutboundError("invalid_request"));
    }
    if (target.protocol !== this.protocol || target.username !== "" || target.password !== "") {
      return Promise.reject(new OutboundError("invalid_request"));
    }
    // An IP address in the URL is connected to without any lookup, so it has to be checked here.
    const host = target.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) !== 0 && !this.allowNonPublic && !isPublicAddress(host)) return Promise.reject(new OutboundError("blocked_address"));

    return new Promise<OutboundResponse>((resolve, reject) => {
      let finished = false;
      const finish = (action: () => void): void => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        action();
      };
      let request: ReturnType<typeof https.request>;
      try {
        request = this.transport(
          {
            protocol: this.protocol,
            hostname: host,
            port: target.port === "" ? undefined : Number(target.port),
            path: `${target.pathname}${target.search}`,
            method: input.method,
            headers: { ...input.headers, ...(input.body === undefined ? {} : { "content-length": String(Buffer.byteLength(input.body)) }) },
            lookup: this.lookup as never,
            agent: false,
          },
          (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > input.maxResponseBytes) {
                // Settle first: a stream that already has all its data would otherwise still end normally.
                finish(() => reject(new OutboundError("response_too_large")));
                return request.destroy();
              }
              chunks.push(chunk);
            });
            response.on("end", () =>
              finish(() => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") })),
            );
            response.on("error", () => finish(() => reject(new OutboundError("unreachable"))));
          },
        );
      } catch {
        return reject(new OutboundError("invalid_request"));
      }
      const deadline = setTimeout(() => request.destroy(new OutboundError("timeout")), input.timeoutMs);
      request.on("error", (error: Error) => {
        if (error instanceof OutboundError) return finish(() => reject(error));
        if (error instanceof BlockedAddressError) return finish(() => reject(new OutboundError("blocked_address")));
        return finish(() => reject(new OutboundError("unreachable")));
      });
      request.end(input.body);
    });
  }
}
