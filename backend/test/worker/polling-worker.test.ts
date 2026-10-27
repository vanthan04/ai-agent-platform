import { describe, expect, it } from "vitest";
import type { WorkerLog } from "../../src/worker";
import type { RunProcessor } from "../../src/worker/application/run-processor";
import { PollingWorker } from "../../src/worker/infrastructure/polling-worker";

const silent: WorkerLog & { errors: string[] } = { errors: [], info() {}, error(message) { this.errors.push(message); } };

const processorOf = (results: (() => Promise<{ claimed: number; recovered: number }>)[]): { processor: RunProcessor; passes: () => number } => {
  let index = 0;
  const processor = { tick: () => (results[Math.min(index++, results.length - 1)] as () => Promise<{ claimed: number; recovered: number }>)() } as unknown as RunProcessor;
  return { processor, passes: () => index };
};

const idle = async () => ({ claimed: 0, recovered: 0 });
const busy = async () => ({ claimed: 1, recovered: 0 });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("PollingWorker", () => {
  it("asks again at once while there is work, and pauses when a pass finds none", async () => {
    const { processor, passes } = processorOf([busy, busy, busy, idle]);
    const worker = new PollingWorker(processor, silent, 10_000);
    worker.onApplicationBootstrap();
    await wait(60);
    expect(passes()).toBe(4); // three busy passes back to back, then one idle pass and a long pause
    await worker.onModuleDestroy();
  });

  it("stops during a pause without waiting for it to end", async () => {
    const { processor } = processorOf([idle]);
    const worker = new PollingWorker(processor, silent, 60_000);
    worker.onApplicationBootstrap();
    await wait(30);
    const started = Date.now();
    await worker.onModuleDestroy();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("finishes the pass it is in before it stops, and starts no other", async () => {
    let finishPass: (() => void) | undefined;
    let passes = 0;
    const processor = {
      tick: () =>
        new Promise<{ claimed: number; recovered: number }>((resolve) => {
          passes++;
          finishPass = () => resolve({ claimed: 1, recovered: 0 });
        }),
    } as unknown as RunProcessor;
    const worker = new PollingWorker(processor, silent, 5);
    worker.onApplicationBootstrap();
    await wait(20);
    let stopped = false;
    const stopping = worker.onModuleDestroy().then(() => {
      stopped = true;
    });
    await wait(30);
    expect(stopped).toBe(false); // still inside the pass
    finishPass?.();
    await stopping;
    expect(stopped).toBe(true);
    expect(passes).toBe(1);
  });

  it("logs a failed pass by the kind of error only and keeps going", async () => {
    const log = { ...silent, errors: [] as string[] };
    const failing = async () => {
      throw Object.assign(new Error("password=hunter2 refused"), { name: "ConnectionError" });
    };
    const { processor, passes } = processorOf([failing, busy, idle]);
    const worker = new PollingWorker(processor, log, 10);
    worker.onApplicationBootstrap();
    await wait(80);
    await worker.onModuleDestroy();
    expect(passes()).toBeGreaterThanOrEqual(3);
    expect(log.errors).toEqual(["a pass failed: ConnectionError"]);
  });
});
