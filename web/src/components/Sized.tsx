import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * The element's width, measured on mount and kept current. Uses ResizeObserver where it fires
 * and also listens to window resizes, so charts never render at zero width if one of them is
 * missing (some embedded and headless browsers never deliver ResizeObserver callbacks).
 */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = Math.round(el.getBoundingClientRect().width);
      if (width > 0) setW((prev) => (Math.abs(prev - width) > 1 ? width : prev));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    const t = window.setTimeout(measure, 120);   // after fonts and the layout settle
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); window.clearTimeout(t); };
  }, []);
  return [ref, w] as const;
}

/**
 * A ResizeObserver that also reports on observe() and on window resizes. Libraries that size
 * themselves from ResizeObserver (React Three Fiber's Canvas) take it as a polyfill, so they still get
 * a size in browsers that never deliver ResizeObserver callbacks.
 */
export class RobustResizeObserver {
  private ro: ResizeObserver | null;
  private els = new Set<Element>();
  private timers: number[] = [];
  private onWindow = () => this.fire();

  constructor(private cb: ResizeObserverCallback) {
    this.ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(cb) : null;
    window.addEventListener("resize", this.onWindow);
  }

  private fire() {
    const entries = [...this.els].map((target) => ({ target, contentRect: target.getBoundingClientRect() })) as unknown as ResizeObserverEntry[];
    if (entries.length) this.cb(entries, this as unknown as ResizeObserver);
  }

  observe(el: Element) {
    this.els.add(el);
    this.ro?.observe(el);
    this.timers.push(window.requestAnimationFrame(() => this.fire()), window.setTimeout(() => this.fire(), 150));
  }

  unobserve(el: Element) {
    this.els.delete(el);
    this.ro?.unobserve(el);
  }

  disconnect() {
    this.els.clear();
    this.ro?.disconnect();
    window.removeEventListener("resize", this.onWindow);
    this.timers.forEach((t) => { window.cancelAnimationFrame(t); window.clearTimeout(t); });
  }
}

/** Render-prop wrapper: gives a chart its exact pixel width. */
export function Sized({ height, children }: { height: number; children: (width: number) => ReactNode }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  return <div ref={ref} style={{ width: "100%", height, minWidth: 0 }}>{children(w)}</div>;
}
