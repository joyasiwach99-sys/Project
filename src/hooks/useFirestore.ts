import { useEffect, useState } from "react";
import { doc, onSnapshot, type DocumentReference, type Query } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface LiveResult<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribe to a Firestore query in real time. Pass `null` to skip.
 * `key` must change whenever the query changes (queries are not comparable).
 */
export function useLiveQuery<T extends { id: string }>(q: Query | null, key: string): LiveResult<T[]> {
  const [state, setState] = useState<LiveResult<T[]>>({ data: [], loading: !!q, error: null });
  useEffect(() => {
    if (!q) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T), loading: false, error: null }),
      (error) => {
        console.error(`[firestore] ${key}`, error);
        setState({ data: [], loading: false, error });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function useLiveDoc<T extends { id: string }>(path: string | null): LiveResult<T | null> {
  const [state, setState] = useState<LiveResult<T | null>>({ data: null, loading: !!path, error: null });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const ref = doc(db, path) as DocumentReference;
    return onSnapshot(
      ref,
      (snap) => setState({ data: snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null, loading: false, error: null }),
      (error) => {
        console.error(`[firestore] ${path}`, error);
        setState({ data: null, loading: false, error });
      },
    );
  }, [path]);
  return state;
}

/** Re-render every `ms` so relative times ("12s ago") and online/offline states stay fresh. */
export function useNow(ms = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
