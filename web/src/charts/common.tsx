import { reducedMotion } from "../motion";
import type { Palette } from "../theme";

// Shared axis / grid styling: hairline, solid, recessive. Ticks in muted ink, tabular figures.
export function axisProps(pal: Palette) {
  return {
    stroke: pal.axis,
    tick: { fill: pal.muted, fontSize: 12 },
    tickLine: false,
    axisLine: { stroke: pal.axis },
  } as const;
}

export function yAxisProps(pal: Palette) {
  return { ...axisProps(pal), axisLine: false, width: 56 } as const;
}

export function gridProps(pal: Palette) {
  return { stroke: pal.grid, strokeDasharray: undefined, vertical: false } as const;
}

export const cursorLine = (pal: Palette) => ({ stroke: pal.ink2, strokeWidth: 1 });
export const cursorBand = (pal: Palette) => ({ fill: pal.grid, opacity: 0.5 });

export const MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };

/** Series entrance: a short ease-out draw (bars grow, lines trace), skipped entirely for reduced motion. */
export function anim(delay = 0) {
  const on = !reducedMotion();
  return { isAnimationActive: on, animationDuration: 650, animationBegin: delay, animationEasing: "ease-out" as const };
}

/** A direct label at a line's last point (Recharts `label` prop): the series name, in ink, beside a dot of its colour. */
export function EndLabel(props: { x?: number; y?: number; index?: number; last: number; text: string; color: string; pal: Palette }) {
  const { x, y, index, last, text, color, pal } = props;
  if (index !== last || x == null || y == null) return null;
  return (
    <g>
      <circle cx={x} cy={y} r={4} fill={color} stroke={pal.surface} strokeWidth={2} />
      <text x={x + 9} y={y + 4} fill={pal.ink} fontSize={12} fontWeight={650}>{text}</text>
    </g>
  );
}
