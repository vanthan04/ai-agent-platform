"use client";

import { api } from "@/lib/api/client";
import { useQuery } from "@/lib/api/hooks";
import type { RunEvent } from "@/lib/api/types";
import { RUN_STATUS, formatTime } from "@/lib/status";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";

export function eventText(event: RunEvent): { tag: string; text: string; tone: string } {
  if (event.type === "log" && "message" in event) {
    return { tag: event.level.toUpperCase(), text: event.message, tone: event.level === "error" ? "bg-bad-soft text-bad" : event.level === "warn" ? "bg-warn-soft text-warn" : "bg-info-soft text-info" };
  }
  if (event.type === "run.status_changed" && "from" in event) {
    return { tag: "STATUS", text: `${RUN_STATUS[event.from].label} → ${RUN_STATUS[event.to].label}`, tone: "bg-violet-soft text-violet" };
  }
  return { tag: event.type.toUpperCase(), text: "", tone: "bg-surface-2 text-muted" };
}

/** The recorded steps of a run, refreshed while the run is still going. */
export function RunLog({ projectId, runId, active }: { projectId: string; runId: string; active: boolean }) {
  const events = useQuery(
    `events:${runId}`,
    (signal) => api<RunEvent[]>("GET", `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/events?limit=500`, { signal }),
    active ? 1500 : false,
  );

  const state = events.data === undefined ? (events.error === undefined ? "Loading" : "Not connected") : events.error !== undefined ? "Reconnecting" : active ? "Connected" : "Finished";
  const tone = state === "Connected" ? "ok" : state === "Finished" ? "neutral" : state === "Loading" ? "info" : "warn";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Live logs</h4>
        <Badge tone={tone}>{state}</Badge>
      </div>
      <div role="log" aria-live="polite" aria-label="Run events" className="max-h-64 overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs">
        {events.data === undefined ? (
          <p className="text-muted">{events.error === undefined ? "Loading events…" : "The events could not be loaded."}</p>
        ) : events.data.length === 0 ? (
          <p className="text-muted">No events yet.</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {events.data.map((event) => {
              const { tag, text, tone: tagTone } = eventText(event);
              return (
                <li key={event.seq} className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-3">
                  <span className="text-muted">{formatTime(event.at)}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", tagTone)}>{tag}</span>
                  <span className="break-words">{text}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
