"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, isAbort } from "./client";

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  /** True until the first answer (data or error) arrives. */
  loading: boolean;
  /** Fetches again now and resolves when the answer is in. */
  refresh: () => Promise<void>;
}

/**
 * Loads `fetcher(signal)` when `key` changes and keeps the last good answer on screen while it reloads or fails.
 * `pollMs` may be a number or a function of the latest data (return `false` to stop polling, for example when a run has ended).
 * A `null` key means "do not load yet".
 */
export function useQuery<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>, pollMs?: number | false | ((data: T | undefined) => number | false)): QueryState<T> {
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: unknown; loading: boolean }>({ key, data: undefined, error: undefined, loading: key !== null });
  const fetcherRef = useRef(fetcher);
  const pollRef = useRef(pollMs);
  useEffect(() => {
    fetcherRef.current = fetcher;
    pollRef.current = pollMs;
  });
  const reload = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const run = async (): Promise<void> => {
      let latest: T | undefined;
      try {
        latest = await fetcherRef.current(controller.signal);
        if (!cancelled) setState({ key, data: latest, error: undefined, loading: false });
      } catch (error) {
        if (cancelled || isAbort(error)) return;
        setState((previous) => ({ key, data: previous.key === key ? previous.data : undefined, error, loading: false }));
      }
      const next = typeof pollRef.current === "function" ? pollRef.current(latest) : pollRef.current;
      if (!cancelled && typeof next === "number") timer = setTimeout(run, next);
    };
    reload.current = async () => {
      clearTimeout(timer);
      await run();
    };
    setState((previous) => (previous.key === key ? previous : { key, data: undefined, error: undefined, loading: true }));
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  const refresh = useCallback(() => reload.current(), []);
  const current = state.key === key ? state : { data: undefined, error: undefined, loading: key !== null };
  return { data: current.data, error: current.error, loading: current.loading, refresh };
}

export interface ActionState<A extends unknown[], R> {
  run: (...args: A) => Promise<R | undefined>;
  pending: boolean;
  /** The message to show next to the control, or `undefined`. */
  error: string | undefined;
  reset: () => void;
}

/** Wraps a change (create, save, delete): tracks that it is running and what went wrong, and never throws to the caller. */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>): ActionState<A, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  });
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true);
    setError(undefined);
    try {
      return await actionRef.current(...args);
    } catch (caught) {
      setError(describeError(caught));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  const reset = useCallback(() => setError(undefined), []);
  return { run, pending, error, reset };
}
