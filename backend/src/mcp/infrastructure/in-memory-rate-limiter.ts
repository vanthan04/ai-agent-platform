import type { RateLimiter } from "../application/ports";

/**
 * A sliding window per key, kept in this process. Good enough to stop one project from using the connection test as a
 * scanner; with several app instances each keeps its own count, so the real limit is per instance.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(key: string): boolean {
    const now = this.now();
    const recent = (this.attempts.get(key) ?? []).filter((at) => now - at < this.windowMs);
    const allowed = recent.length < this.limit;
    if (allowed) recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > 1_000) this.forgetIdleKeys(now);
    return allowed;
  }

  private forgetIdleKeys(now: number): void {
    for (const [key, times] of this.attempts) {
      if (times.every((at) => now - at >= this.windowMs)) this.attempts.delete(key);
    }
  }
}
