import { useState } from "react";
import type { FlowItem, ShockResult } from "../api";
import { ChartFrame, DataTable } from "../components/ui";
import { money } from "../format";
import { usePalette, type Palette } from "../theme";
import { Sized } from "../components/Sized";

// A typical month after the shock as a two-column flow: where the money comes from (left) and where it goes
// (right). The server balances both sides (plan.money_flow), so the ribbons only split that total for drawing.
// Ribbons take the colour of their source: income in blue, money taken from savings in tangerine.

interface Seg { item: FlowItem; y0: number; y1: number }

function stack(items: FlowItem[], top: number, scale: number, gap: number): Seg[] {
  let y = top;
  return items.filter((i) => i.amount > 0.5).map((item) => {
    const h = Math.max(2, item.amount * scale);
    const seg = { item, y0: y, y1: y + h };
    y += h + gap;
    return seg;
  });
}

function sourceColor(pal: Palette, key: string) {
  return key === "savings" ? pal.shock : pal.today;
}

export function MoneyFlow({ r, stale, simple }: { r: ShockResult; stale?: boolean; simple?: boolean }) {
  const pal = usePalette();
  const f = r.flow;
  const [hover, setHover] = useState<string | null>(null);
  const fromSavings = f.in.find((i) => i.key === "savings")?.amount ?? 0;
  const sub = fromSavings > 0
    ? `${money(fromSavings)} a month has to come out of savings`
    : "Income covers everything, so savings aren't touched";
  const rows = [...f.in.map((i) => ({ side: "In", ...i })), ...f.out.map((o) => ({ side: "Out", ...o }))];
  const table = (
    <DataTable caption="A typical month after the shock" rows={rows} columns={[
      { key: "s", label: "", render: (d) => d.side },
      { key: "l", label: "Item", render: (d) => d.label },
      { key: "a", label: "Per month", align: "r", render: (d) => money(d.amount) },
    ]} />
  );
  const H = 260;
  return (
    <ChartFrame title={simple ? "Where a month's money goes" : "A month's money after the shock"} sub={sub} table={table} stale={stale}
                legend={[{ label: "From income", color: pal.today }, { label: "From savings", color: pal.shock }]}
                label={`Money flow: ${f.in.map((i) => `${i.label} ${money(i.amount)}`).join(", ")} in; ${f.out.map((o) => `${o.label} ${money(o.amount)}`).join(", ")} out`}>
      <Sized height={H}>{(w) => {
        const narrow = w < 460;
        const labelW = narrow ? 84 : 132, nodeW = 12, gap = 8, top = 6;
        const xL = labelW, xR = w - labelW - nodeW;
        const nOut = f.out.filter((o) => o.amount > 0.5).length, nIn = f.in.filter((i) => i.amount > 0.5).length;
        const scale = (H - top * 2 - gap * Math.max(nOut, nIn)) / Math.max(1, f.total);
        const L = stack(f.in, top, scale, gap);
        const R = stack(f.out, top, scale, gap);
        // Ribbons: walk both stacks in order and connect the overlapping parts of the running total.
        const ribbons: { from: Seg; to: Seg; a0: number; a1: number; b0: number; b1: number }[] = [];
        let i = 0, j = 0, usedL = 0, usedR = 0;
        while (i < L.length && j < R.length) {
          const l = L[i], rr = R[j];
          const take = Math.min(l.item.amount - usedL, rr.item.amount - usedR);
          if (take > 0.01) {
            const a0 = l.y0 + usedL * scale, b0 = rr.y0 + usedR * scale;
            ribbons.push({ from: l, to: rr, a0, a1: a0 + take * scale, b0, b1: b0 + take * scale });
          }
          usedL += take; usedR += take;
          if (l.item.amount - usedL < 0.01) { i++; usedL = 0; }
          if (rr.item.amount - usedR < 0.01) { j++; usedR = 0; }
        }
        const cx = (xL + nodeW + xR) / 2;
        const label = (s: Seg, side: "l" | "r") => {
          const yMid = (s.y0 + s.y1) / 2;
          const x = side === "l" ? xL - 8 : xR + nodeW + 8;
          const anchor = side === "l" ? "end" : "start";
          // Long names wrap onto two lines so they stay inside the label column.
          const words = s.item.label.split(" ");
          const lines = s.item.label.length > (narrow ? 10 : 16) && words.length > 1
            ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")]
            : [s.item.label];
          return (
            <text key={`t${side}${s.item.key}`} x={x} y={yMid - (lines.length - 1) * 7} textAnchor={anchor} fill={pal.ink2} fontSize={narrow ? 11 : 12}>
              {lines.map((ln, k) => <tspan key={k} x={x} dy={k === 0 ? -2 : 14} fontWeight={650} fill={pal.ink}>{ln}</tspan>)}
              <tspan x={x} dy={15} style={{ fontVariantNumeric: "tabular-nums" }}>{money(s.item.amount)}</tspan>
            </text>
          );
        };
        return (
          <svg width={w} height={H} aria-hidden className="flow">
            {ribbons.map((rb, k) => {
              const on = hover == null || hover === rb.from.item.key || hover === rb.to.item.key;
              const c = sourceColor(pal, rb.from.item.key);
              const d = `M${xL + nodeW},${rb.a0} C${cx},${rb.a0} ${cx},${rb.b0} ${xR},${rb.b0} L${xR},${rb.b1} C${cx},${rb.b1} ${cx},${rb.a1} ${xL + nodeW},${rb.a1} Z`;
              return <path key={k} d={d} fill={c} fillOpacity={on ? 0.32 : 0.08} className="flow-ribbon" />;
            })}
            {L.map((s) => (
              <rect key={`l${s.item.key}`} x={xL} y={s.y0} width={nodeW} height={s.y1 - s.y0} rx={3} fill={sourceColor(pal, s.item.key)}
                    onMouseEnter={() => setHover(s.item.key)} onMouseLeave={() => setHover(null)} />
            ))}
            {R.map((s) => (
              <rect key={`r${s.item.key}`} x={xR} y={s.y0} width={nodeW} height={s.y1 - s.y0} rx={3}
                    fill={s.item.key === "left" ? pal.good : s.item.key === "fixed" ? pal.neutral : pal.ink2}
                    onMouseEnter={() => setHover(s.item.key)} onMouseLeave={() => setHover(null)} />
            ))}
            {L.map((s) => label(s, "l"))}
            {R.map((s) => label(s, "r"))}
          </svg>
        );
      }}</Sized>
    </ChartFrame>
  );
}
