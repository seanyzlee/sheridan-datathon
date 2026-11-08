// Motion system: GSAP with the React hook, set up the way the official gsap-core / gsap-react skills
// recommend. Every animation here respects prefers-reduced-motion (it jumps straight to the end state),
// animates transforms and opacity rather than layout, and is cleaned up by useGSAP on unmount.

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef, type RefObject } from "react";

gsap.registerPlugin(useGSAP);
gsap.defaults({ ease: "power3.out", duration: 0.6 });

export { gsap, useGSAP };

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Fade-and-rise the elements marked .reveal inside `scope`, staggered, whenever `key` changes. */
export function useReveal(scope: RefObject<HTMLElement>, key: unknown) {
  useGSAP(() => {
    if (reducedMotion()) return;
    const items = scope.current?.querySelectorAll<HTMLElement>(".reveal");
    if (!items?.length) return;
    gsap.fromTo(items, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.55, stagger: 0.06, clearProps: "transform" });
  }, { scope, dependencies: [key] });
}

/** Text that counts from its previous value to `value` (numbers come from the server; this only animates them). */
export function useCountUp(ref: RefObject<HTMLElement>, value: number, format: (n: number) => string) {
  const last = useRef<number | null>(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    const from = last.current ?? 0;
    last.current = value;
    if (reducedMotion() || !Number.isFinite(value) || from === value) { el.textContent = format(value); return; }
    const obj = { v: from };
    gsap.to(obj, { v: value, duration: 0.9, ease: "power2.out", onUpdate: () => { el.textContent = format(obj.v); }, onComplete: () => { el.textContent = format(value); } });
  }, { dependencies: [value] });
}
