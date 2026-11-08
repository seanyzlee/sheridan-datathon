import { useRef } from "react";
import { useCountUp } from "../motion";

/** A number that counts up to its new value. `text` is the exact server-formatted value, used for
 *  screen readers and as the final frame, so the animation can never show a different final figure. */
export function AnimatedNumber({ value, format, text, className }: { value: number; format: (n: number) => string; text?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCountUp(ref, value, (n) => (n === value && text ? text : format(n)));
  return (
    <span className={className}>
      <span ref={ref} aria-hidden="true">{text ?? format(value)}</span>
      <span className="sr-only">{text ?? format(value)}</span>
    </span>
  );
}
