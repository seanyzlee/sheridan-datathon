import { useRef } from "react";
import type { AutopilotStep } from "../api";
import { DataTable } from "../components/ui";
import { gsap, reducedMotion, useGSAP } from "../motion";
import { usePalette } from "../theme";
import { Sized } from "../components/Sized";

// The recovery ladder as a staircase: the first block is the runway with the shock and no steps, then each
// step's block stands at the runway once that step (and the ones before it) are taken. Heights are the
// server's runway_before / runway_after; the vertical scale is layout only. Steps switched on are solid,
// the rest outlined; the step that first clears the target gets a check mark.

const mo = (m: number, ns = false) => (ns || m >= 120 ? "No gap" : `${m.toFixed(1)}`);

export function Staircase({ steps, chosen, target }: { steps: AutopilotStep[]; chosen: string[]; target: number }) {
  const pal = usePalette();
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (reducedMotion()) return;
    // Grow each block up from the baseline by animating its y/height attributes (SVG-safe, no transforms).
    ref.current?.querySelectorAll<SVGRectElement>(".st-block").forEach((el, i) => {
      const y = Number(el.dataset.y), h = Number(el.dataset.h);
      gsap.fromTo(el, { attr: { y: y + h, height: 0 } }, { attr: { y, height: h }, duration: 0.5, delay: i * 0.09, ease: "power3.out" });
    });
  }, { scope: ref, dependencies: [steps.map((s) => s.id).join(), target] });

  if (!steps.length) return null;
  const start = steps[0].runway_before;
  const finite = [start, ...steps.map((s) => s.runway_after)].filter((m) => m < 120);
  const top = Math.max(target * 1.35, ...finite.map((m) => m * 1.12), 3);
  const clears = steps.findIndex((s) => s.runway_after >= target);
  const cols = [{ id: "start", label: "Now", value: start, ns: start >= 120, on: true, n: 0 },
                ...steps.map((s, i) => ({ id: s.id, label: `${i + 1}`, value: s.runway_after, ns: s.no_shortfall_after, on: chosen.includes(s.id), n: i + 1 }))];
  const H = 150;

  return (
    <figure className="staircase" aria-label={`Staircase: runway ${mo(start)} months now, then ${steps.map((s, i) => `step ${i + 1} ${mo(s.runway_after, s.no_shortfall_after)}`).join(", ")}, against a ${target}-month goal.`}>
      <div ref={ref}>
        <Sized height={H + 34}>{(w) => {
          const padL = 4, padR = 54, padT = 22;
          const colW = (w - padL - padR) / cols.length;
          const y = (m: number) => padT + (1 - Math.min(m, top) / top) * H;
          const ty = y(target);
          return (
            <svg width={w} height={H + 34} role="presentation">
              {cols.map((c, i) => {
                const x = padL + i * colW;
                const yTop = y(c.value);
                const isStart = i === 0;
                const fill = isStart ? pal.shock : c.on ? pal.third : "transparent";
                return (
                  <g key={c.id}>
                    <rect className="st-block" x={x + 2} y={yTop} width={colW - 4} height={padT + H - yTop} rx={5}
                          data-y={yTop} data-h={padT + H - yTop}
                          fill={fill} fillOpacity={isStart ? 0.85 : c.on ? 0.8 : 0}
                          stroke={isStart ? pal.shock : pal.third} strokeWidth={c.on || isStart ? 0 : 1.5} strokeDasharray={c.on || isStart ? undefined : "4 3"} />
                    <text x={x + colW / 2} y={yTop - 6} textAnchor="middle" fill={pal.ink} fontSize={12} fontWeight={700}
                          style={{ fontVariantNumeric: "tabular-nums" }}>
                      {i === clears + 1 ? "✓ " : ""}{mo(c.value, c.ns)}
                    </text>
                    <text x={x + colW / 2} y={padT + H + 18} textAnchor="middle" fill={pal.muted} fontSize={12}>
                      {isStart ? "Now" : `Step ${c.label}`}
                    </text>
                  </g>
                );
              })}
              <line x1={padL} x2={w - padR + 4} y1={ty} y2={ty} stroke={pal.ink} strokeDasharray="5 4" strokeWidth={1.5} />
              <text x={w - padR + 8} y={ty + 4} fill={pal.ink} fontSize={12} fontWeight={650}>{target} mo goal</text>
              <line x1={padL} x2={w - padR + 4} y1={padT + H} y2={padT + H} stroke={pal.axis} />
            </svg>
          );
        }}</Sized>
      </div>
      <figcaption className="console-hint">Months of savings after each step, taken in order. Solid steps are switched on.</figcaption>
      <details className="st-table">
        <summary>Show as a table</summary>
        <DataTable caption="Runway after each step" rows={steps} columns={[
          { key: "s", label: "Step", render: (s) => s.label },
          { key: "v", label: "Frees up", align: "r", render: (s) => s.saving_text },
          { key: "a", label: "Adds", align: "r", render: (s) => s.adds_text },
          { key: "r", label: "Runway after", align: "r", render: (s) => s.runway_after_text },
        ]} />
      </details>
    </figure>
  );
}
