import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { describeError } from "@/lib/api/client";
import { Button } from "./Button";
import { cn } from "./cn";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      {label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children ? <p className="max-w-md text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Could not load this" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-border bg-bad-soft p-5">
      <p className="flex items-center gap-2 font-medium text-bad">
        <AlertTriangle aria-hidden className="size-5" />
        {title}
      </p>
      <p className="text-sm">{describeError(error)}</p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** An error next to the control that caused it. Read out by screen readers when it appears. */
export function InlineError({ children }: { children?: string }) {
  return children ? (
    <p role="alert" className="text-sm text-bad">
      {children}
    </p>
  ) : null;
}
