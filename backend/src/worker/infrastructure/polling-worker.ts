import type { OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { WorkerLog } from "../application/ports";
import type { RunProcessor } from "../application/run-processor";

/**
 * Calls the processor again and again. When a pass found nothing to do it waits a little before asking again; a pass that
 * did work is followed at once by another. On shutdown it finishes the pass it is in and stops, so a run is never left in
 * the middle of a step by a normal stop.
 */
export class PollingWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private stopping = false;
  private running: Promise<void> | undefined;
  private wake: (() => void) | undefined;

  constructor(
    private readonly processor: RunProcessor,
    private readonly log: WorkerLog,
    private readonly idleMs = 2_000,
  ) {}

  onApplicationBootstrap(): void {
    this.log.info("worker started");
    this.running = this.loop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    await this.running;
    this.log.info("worker stopped");
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      let busy = false;
      try {
        const result = await this.processor.tick();
        busy = result.claimed > 0 || result.recovered > 0;
      } catch (error) {
        // A failed pass (for example the database is briefly away) is logged by kind only and tried again after a pause.
        this.log.error(`a pass failed: ${error instanceof Error ? error.name : "unknown error"}`);
      }
      if (!busy && !this.stopping) await this.sleep();
    }
  }

  private sleep(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, this.idleMs);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
