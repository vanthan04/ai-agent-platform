import { CircleCheck, Clock, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { TaskStatus } from "@/lib/status";
import { cn } from "@/components/ui/cn";

interface Metric {
  status: TaskStatus;
  label: string;
  icon: LucideIcon;
  tone: string;
}

const METRICS: Metric[] = [
  { status: "ready", label: "Ready", icon: CircleCheck, tone: "text-ok" },
  { status: "in_progress", label: "In progress", icon: Clock, tone: "text-info" },
  { status: "blocked", label: "Blocked", icon: TriangleAlert, tone: "text-warn" },
  { status: "failed", label: "Failed", icon: OctagonAlert, tone: "text-bad" },
];

/** Counts of tasks by where they stand. Each card also sets the status filter, so a number can be clicked to see its tasks. */
export function MetricCards({ counts, selected, onSelect }: { counts: Record<TaskStatus, number>; selected: TaskStatus | "all"; onSelect: (status: TaskStatus | "all") => void }) {
  return (
    <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Tasks by status">
      {METRICS.map(({ status, label, icon: Icon, tone }) => {
        const active = selected === status;
        return (
          <li key={status}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(active ? "all" : status)}
              className={cn("flex w-full items-center justify-between rounded-xl border bg-surface p-5 text-left shadow-sm transition hover:border-accent", active ? "border-accent-strong ring-1 ring-accent-strong" : "border-border")}
            >
              <span>
                <span className="block text-sm text-muted">{label}</span>
                <span className="block text-3xl font-semibold" aria-label={`${counts[status]} ${label}`}>
                  {counts[status]}
                </span>
              </span>
              <Icon aria-hidden className={cn("size-8", tone)} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
