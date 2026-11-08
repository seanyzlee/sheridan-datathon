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
