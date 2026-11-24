import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";

export function pickAllowedKeys<T extends Record<string, unknown>>(
  raw: Record<string, unknown>,
  defaults: T,
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      out[key] = raw[key] as T[keyof T & string];
    }
  }
  return out;
}

/**
 * Persists non-sensitive tool UI preferences into OpenIDEA's host::storage (debounced) without touching localStorage.
 */
export function useToolState<T extends Record<string, unknown>>(
  toolId: string,
  defaults: T,
  sanitizeForSave?: (state: T) => Partial<T>,
): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [state, setState] = useState<T>(defaults);
  const [loaded, setLoaded] = useState(!bridge.isHosted);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const sanitizeRef = useRef(sanitizeForSave);
  sanitizeRef.current = sanitizeForSave;

  useEffect(() => {
    let live = true;
    if (!bridge.isHosted) return;
    bridge
      .rpc<{ state: Record<string, unknown> | null }>("storage.getToolState", { toolId })
      .then((res) => {
        if (live && res?.state && typeof res.state === "object" && !Array.isArray(res.state)) {
          const allowed = pickAllowedKeys(res.state, defaultsRef.current);
          setState((prev) => ({ ...prev, ...allowed }));
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
          const payload = sanitizeRef.current
            ? sanitizeRef.current(resolved)
            : pickAllowedKeys(resolved as Record<string, unknown>, defaultsRef.current);
          bridge.rpc("storage.setToolState", { toolId, state: payload }).catch(() => {});
        }, 350);
      }
      return resolved;
    });
  };

  return [state, update, loaded];
}
