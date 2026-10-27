import { OutboundError, type SafeHttpClient } from "../../network";
import type { BranchHead, BranchHeadFailure, RepositoryInspector } from "../application/ports";

export interface InspectorLimits {
  timeoutMs: number;
  maxResponseBytes: number;
}

const DEFAULT_LIMITS: InspectorLimits = { timeoutMs: 20_000, maxResponseBytes: 8_000_000 };

const ADVERTISEMENT = "application/x-git-upload-pack-advertisement";

const MAPPED: Readonly<Record<string, BranchHeadFailure>> = {
  blocked_address: "blocked_address",
  timeout: "timeout",
  response_too_large: "too_large",
  unreachable: "unreachable",
  invalid_request: "unsupported",
};

/**
 * Learns where a branch points from the "smart HTTP" ref advertisement every git server over https gives
 * (`GET <repository>/info/refs?service=git-upload-pack`), the same first request `git ls-remote` makes. Nothing is cloned
 * and no credential is sent, so only repositories readable without signing in work today. All traffic goes through
 * `SafeHttpClient`: https, public addresses only, no redirects.
 */
export class GitHttpRepositoryInspector implements RepositoryInspector {
  constructor(
    private readonly http: SafeHttpClient,
    private readonly limits: InspectorLimits = DEFAULT_LIMITS,
    /** Tests talk plain http to this machine; the app always uses https. */
    private readonly protocol: "https:" | "http:" = "https:",
  ) {}

  async branchHead(target: { url: string; branch: string }): Promise<BranchHead> {
    let repository: URL;
    try {
      repository = new URL(target.url);
    } catch {
      return { ok: false, reason: "unsupported" };
    }
    if (repository.protocol !== this.protocol) return { ok: false, reason: "unsupported" };
    const base = `${repository.origin}${repository.pathname.replace(/\/+$/, "")}`;

    let response;
    try {
      response = await this.http.send({
        url: `${base}/info/refs?service=git-upload-pack`,
        method: "GET",
        headers: { accept: ADVERTISEMENT, "user-agent": "git/2.43.0" },
        timeoutMs: this.limits.timeoutMs,
        maxResponseBytes: this.limits.maxResponseBytes,
      });
    } catch (error) {
      if (error instanceof OutboundError) return { ok: false, reason: MAPPED[error.failure] ?? "unreachable" };
      throw error;
    }

    // A repository that is private or missing answers 401, 403 or 404, and from outside they cannot be told apart.
    if (response.status === 401 || response.status === 403 || response.status === 404) return { ok: false, reason: "not_found" };
    if (response.status !== 200) return { ok: false, reason: "unreachable" };
    if (!String(response.headers["content-type"] ?? "").toLowerCase().includes(ADVERTISEMENT)) return { ok: false, reason: "invalid_response" };

    const wanted = `refs/heads/${target.branch}`;
    // Each advertised ref is `<4-digit length><commit id> <ref name>`, the first one followed by `\0<capabilities>`.
    for (const match of response.body.matchAll(/([0-9a-f]{40}|[0-9a-f]{64}) (refs\/[^\0\n\r]+)/g)) {
      if (match[2] === wanted && match[1] !== undefined) return { ok: true, commitSha: match[1] };
    }
    return { ok: false, reason: "not_found" };
  }
}
