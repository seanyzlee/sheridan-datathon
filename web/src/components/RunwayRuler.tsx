import { useWidth } from "./Sized";
import type { Runway } from "../api";
import { isOpenEnded } from "../format";
import { usePalette } from "../theme";

interface Row { label: string; runway: Runway; color: string }

/**
 * The hero: each runway drawn as distance along a month ruler, so "4.2 months" reads as
 * "the money runs out here", next to the EI-length / goal marker it has to clear.
 */
export function RunwayRuler({ today, after, target, targetLabel, afterLabel = "After the shock" }: {
  today: Runway; after?: Runway | null; target: number; targetLabel: string; afterLabel?: string;
}) {
  const pal = usePalette();
  const [ref, width] = useWidth<HTMLDivElement>();
  const rows: Row[] = [{ label: "Today", runway: today, color: pal.today }];
  if (after) rows.push({ label: afterLabel, runway: after, color: pal.shock });

  const finite = rows.map((r) => (isOpenEnded(r.runway) ? 0 : r.runway.months));
  const horizon = Math.min(36, Math.max(12, Math.ceil((Math.max(target, ...finite) + 3) / 6) * 6));
  const padL = 0, padR = 64, top = 26, rowH = 38, axisH = 28;
  const H = top + rows.length * rowH + axisH;
  const x = (m: number) => padL + (Math.min(m, horizon) / horizon) * (width - padL - padR);
  const step = horizon > 24 ? 6 : 3;
  const ticks = Array.from({ length: Math.floor(horizon / step) + 1 }, (_, i) => i * step);
  const axisY = top + rows.length * rowH;

  return (
    <div ref={ref}>
      <svg className="ruler" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img"
           aria-label={rows.map((r) => `${r.label}: ${isOpenEnded(r.runway) ? "no shortfall, 120+ months" : `${r.runway.months.toFixed(1)} months`}`).join(". ") + `. ${targetLabel} at ${target} months.`}>
        {/* month grid */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 6} y2={axisY} stroke={pal.grid} strokeWidth={1} />
            <text x={x(t)} y={axisY + 18} textAnchor="middle" fontSize={12} fill={pal.muted} style={{ fontVariantNumeric: "tabular-nums" }}>
              {t === 0 ? "Now" : t}
            </text>
          </g>
        ))}
        <text x={width - padR + 8} y={axisY + 18} fontSize={12} fill={pal.muted}>months</text>
        <line x1={x(0)} x2={width - padR} y1={axisY} y2={axisY} stroke={pal.axis} strokeWidth={1} />

        {/* target marker */}
        <line x1={x(target)} x2={x(target)} y1={top - 14} y2={axisY} stroke={pal.ink} strokeWidth={1.5} />
        <text x={x(target)} y={top - 18} textAnchor={x(target) > width - 160 ? "end" : "middle"} fontSize={12} fontWeight={640} fill={pal.ink}>
          {targetLabel}
        </text>

        {rows.map((r, i) => {
          const y = top + i * rowH + 20;
          const open = isOpenEnded(r.runway);
          const end = open ? width - padR : x(r.runway.months);
          const short = !open && r.runway.months < target;
          return (
            <g key={r.label}>
              <text x={0} y={y - 10} fontSize={12} fill={pal.ink2} fontWeight={560}>{r.label}</text>
              <rect x={x(0)} y={y - 3} width={Math.max(0, end - x(0))} height={8} rx={4} fill={r.color} />
              {open ? (
                <path d={`M ${end - 2} ${y - 6} L ${end + 8} ${y + 1} L ${end - 2} ${y + 8} Z`} fill={r.color} />
              ) : (
                <circle cx={end} cy={y + 1} r={6} fill={r.color} stroke={pal.surface} strokeWidth={2} />
              )}
              <text x={open ? end + 14 : end + 12} y={y + 5} fontSize={13} fontWeight={680} fill={pal.ink}
                    style={{ fontVariantNumeric: "tabular-nums" }}>
                {open ? "120+" : r.runway.months.toFixed(1)}
              </text>
              {short && r.runway.months > 0 && (
                <rect x={end + 1} y={y - 2} width={Math.max(0, x(target) - end - 1)} height={6} fill="none"
                      stroke={pal.critical} strokeWidth={1} strokeDasharray="3 3" rx={3} opacity={0.8} />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
