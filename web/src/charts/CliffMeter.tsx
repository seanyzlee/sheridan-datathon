import type { ShockResult } from "../api";
import { ChartFrame, DataTable } from "../components/ui";
import { money, pct } from "../format";
import { usePalette } from "../theme";
import { Sized } from "../components/Sized";

// The breaking point as a cliff: a gauge of income kept, 100% on the left down to 0% on the right.
// Safe ground runs from 100% to the breaking income (engine.breaking_point), then the edge.
// "You are here" sits at this shock's income. All positions are the server's numbers.

export function CliffMeter({ r, stale, simple }: { r: ShockResult; stale?: boolean; simple?: boolean }) {
  const pal = usePalette();
  const bp = r.breaking_point;
  const T = r.target;
  const here = r.shock.income_factor;
  // The edge is the lowest income kept that still lasts T months (engine.breaking_point), whether or not
  // this shock is past it. Above 100%: even full income falls short. At or below 0: no income loss breaks them.
  const edge = bp.income_factor;
  const noEdge = edge == null || edge <= 0;
  const allCliff = edge != null && edge > 1;
  const title = simple ? "How much income they can lose" : "Breaking point";
  const sub = allCliff
    ? `Even keeping all their income, their savings don't last ${T} months with the rest of this shock.`
    : noEdge
      ? `Even with no income at all, their savings last ${T} months.`
      : bp.already_broken
        ? `They'd need to keep ${pct(edge)} of their income to last ${T} months; this shock keeps ${pct(here)}.`
        : simple
          ? `Their savings last ${T} months as long as income stays above ${pct(edge)} of normal.`
          : `Lowest income that still lasts ${T} months: ${pct(edge)} of normal, with the rest of the shock held.`;

  const limits = [
    ...(edge != null && edge > 0 && edge <= 1 ? [{ k: "Lowest income kept", v: pct(edge) }] : []),
    ...(bp.one_off > 0 ? [{ k: "Largest one-off cost on top", v: money(bp.one_off) }] : []),
    ...(bp.bills_pct != null && bp.bills_pct > 0 ? [{ k: "Largest bills increase", v: `+${pct(bp.bills_pct)}` }] : []),
  ];
  const table = (
    <DataTable caption="Breaking point" rows={[{ k: "Income kept in this shock", v: pct(here) }, ...limits]} columns={[
      { key: "k", label: "Limit", render: (d) => d.k },
      { key: "v", label: "Value", align: "r", render: (d) => d.v },
    ]} />
  );

  return (
    <ChartFrame title={title} sub={sub} table={table} stale={stale}
                legend={[{ label: `Lasts ${T} months`, color: pal.good }, { label: "Runs out sooner", color: pal.critical }, { label: "This shock", color: pal.ink }]}
                label={`Gauge of income kept from 100% to 0%. ${sub} This shock keeps ${pct(here)} of income.`}>
      <Sized height={simple ? 112 : 128}>{(w) => {
        const padL = 14, padR = 14, y = 44, h = 22;
        const x = (f: number) => padL + (1 - Math.max(0, Math.min(1, f))) * (w - padL - padR);
        const edgeX = allCliff ? x(1) : noEdge ? x(0) : x(edge!);
        const hereX = x(here);
        const ticks = [1, 0.75, 0.5, 0.25, 0];
        const safe = !bp.already_broken;
        return (
          <svg width={w} height={simple ? 112 : 128} aria-hidden>
            <defs>
              <pattern id="cliff-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke={pal.critical} strokeWidth="2" strokeOpacity="0.45" />
              </pattern>
            </defs>
            {/* safe ground, then the drop */}
            <rect x={padL} y={y} width={Math.max(0, edgeX - padL)} height={h} rx={6} fill={pal.good} fillOpacity={0.22} stroke={pal.good} strokeOpacity={0.5} />
            <rect x={edgeX} y={y} width={Math.max(0, w - padR - edgeX)} height={h} rx={6} fill="url(#cliff-hatch)" stroke={pal.critical} strokeOpacity={0.45} />
            {!allCliff && !noEdge && (
              <g>
                <path d={`M${edgeX},${y - 8} L${edgeX},${y + h + 14} L${edgeX + 10},${y + h + 14}`} fill="none" stroke={pal.critical} strokeWidth={2} />
                <text x={edgeX} y={y - 13} textAnchor={edgeX > w - 90 ? "end" : "middle"} fill={pal.critical} fontSize={12} fontWeight={700}>
                  {simple ? "The edge" : `Edge: ${pct(edge)}`}
                </text>
              </g>
            )}
            {/* this shock */}
            <g>
              <line x1={hereX} x2={hereX} y1={y - 4} y2={y + h + 4} stroke={pal.ink} strokeWidth={2.5} />
              <circle cx={hereX} cy={y + h / 2} r={7} fill={safe ? pal.good : pal.critical} stroke={pal.surface} strokeWidth={2.5} />
              <text x={hereX} y={y + h + 30} textAnchor={hereX < 60 ? "start" : hereX > w - 60 ? "end" : "middle"} fill={pal.ink} fontSize={12} fontWeight={700}>
                You are here ({pct(here)})
              </text>
            </g>
            {!simple && ticks.map((t) => (
              <text key={t} x={x(t)} y={12} textAnchor={t === 1 ? "start" : t === 0 ? "end" : "middle"} fill={pal.muted} fontSize={11}>{pct(t)}</text>
            ))}
          </svg>
        );
      }}</Sized>
      {!simple && limits.length > 1 && (
        <ul className="cliff-limits">
          {limits.slice(edge != null && edge > 0 && edge <= 1 ? 1 : 0).map((l) => <li key={l.k}><strong>{l.v}</strong> {l.k.toLowerCase()}</li>)}
        </ul>
      )}
    </ChartFrame>
  );
}
