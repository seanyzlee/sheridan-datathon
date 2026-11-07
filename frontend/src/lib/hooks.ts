import { useEffect, useRef, useState } from 'react';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Tween a number towards its target (ease-out), for headline counters. */
export function useTween(target: number, ms = 450): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  const current = useRef(target);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      current.current = target;
      setV(target);
      return;
    }
    from.current = current.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      current.current = from.current + (target - from.current) * eased;
      setV(current.current);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
