import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";

/**
 * Persists a tool's UI state into OpenIDEA's host::storage (debounced) without touching localStorage.
 */
export function useToolState<T>(toolId: string, defaults: T): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [state, setState] = useState<T>(defaults);
  const [loaded, setLoaded] = useState(!bridge.isHosted);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    if (!bridge.isHosted) return;
    bridge
      .rpc<{ state: Partial<T> | null }>("storage.getToolState", { toolId })
      .then((res) => {
        if (live && res?.state && typeof res.state === "object") {
          setState((prev) => ({ ...prev, ...res.state }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [toolId]);

  const update = (next: T | ((prev: T) => T)) => {
    setState((prev) => {
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      if (bridge.isHosted) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          bridge.rpc("storage.setToolState", { toolId, state: resolved }).catch(() => {});
        }, 350);
      }
      return resolved;
    });
  };

  return [state, update, loaded];
}
