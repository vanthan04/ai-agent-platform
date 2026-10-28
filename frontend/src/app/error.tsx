"use client";

import { Button } from "@/components/ui/Button";

/** Shown when a page throws while rendering. The message is not shown: it may carry details meant for the log. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted">This page could not be shown. Try again; if it keeps happening, tell whoever runs the platform.</p>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
