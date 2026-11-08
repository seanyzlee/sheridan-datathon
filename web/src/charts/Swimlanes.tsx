import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TimeMachineItem } from "../api";
import { ChartFrame, DataTable } from "../components/ui";
import { monthLabel } from "../format";
import { usePalette } from "../theme";
import { Sized } from "../components/Sized";

// One thin lane per defaulted loan, longest warning at the top. The bar runs from the month the EI stress
// test first flagged the customer to the month the default is on record; loans it never flagged are a
// hollow dot at the default. Lead times and months are the server's (discovery.early_warning).

export function Swimlanes({ items, medianLead }: { items: TimeMachineItem[]; medianLead: number }) {
  const pal = usePalette();
  const navigate = useNavigate();
  const [hover, setHover] = useState<number | null>(null);
  const rows = [...items].sort((a, b) => (b.lead_months ?? -1) - (a.lead_months ?? -1));
  const flagged = rows.filter((r) => r.lead_months != null);
  const maxLead = Math.max(12, ...flagged.map((r) => r.lead_months!));
  const lane = 6, top = 26, bottom = 30;
  const height = top + rows.length * lane + bottom;
  const h = rows.find((r) => r.account_id === hover);
  const open = (id: number) => navigate(`/time-machine?replay=${id}${window.location.search.includes("view=") ? `&${window.location.search.match(/view=\w+/)?.[0]}` : ""}`);

  const table = (
    <DataTable caption="Warning time for each defaulted loan" rows={rows} maxHeight={360} onRowClick={(r) => open(r.account_id)} columns={[
      { key: "a", label: "Account", render: (r) => <span className="num">{r.account_id}</span> },
      { key: "f", label: "First warning", render: (r) => (r.first_flag ? monthLabel(r.first_flag) : "Never flagged") },
      { key: "k", label: "Default on record", render: (r) => monthLabel(r.known) },
      { key: "l", label: "Months of warning", align: "r", render: (r) => (r.lead_months == null ? "None" : String(r.lead_months)) },
    ]} />
  );

  return (
    <ChartFrame title="Every default, and how early the warning came"
                sub={`${rows.length} defaulted loans. Each bar runs from the first warning (EI stress test under 2 months) to the default on record. Click one to replay it.`}
                legend={[{ label: "Warned ahead", color: pal.shock }, { label: "Default on record", color: pal.critical }, { label: "Never flagged", color: pal.neutral }]}
                table={table}
                label={`Swimlane chart: ${flagged.length} of ${rows.length} defaulted loans were flagged ahead, a median of ${medianLead.toFixed(0)} months before default.`}>
      <Sized height={height}>{(w) => {
        const padL = 8, padR = 16;
        const x = (lead: number) => padL + (1 - lead / maxLead) * (w - padL - padR);   // right edge = default
        const ticks = [0, 12, 24, 36, 48, 60].filter((t) => t <= maxLead);
        return (
          <svg width={w} height={height} className="lanes" onMouseLeave={() => setHover(null)} aria-hidden>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={top - 6} y2={height - bottom + 4} stroke={pal.grid} />
                <text x={x(t)} y={height - 10} textAnchor={t === 0 ? "end" : "middle"} fill={pal.muted} fontSize={11}>
                  {t === 0 ? "Default" : `${t} mo before`}
                </text>
              </g>
            ))}
            <line x1={x(medianLead)} x2={x(medianLead)} y1={top - 14} y2={height - bottom + 4} stroke={pal.ink} strokeDasharray="4 3" />
            <text x={x(medianLead)} y={top - 16} textAnchor="middle" fill={pal.ink} fontSize={11} fontWeight={700}>
              Median {medianLead.toFixed(0)} months
            </text>
            {rows.map((r, i) => {
              const cy = top + i * lane + lane / 2;
              const on = hover === r.account_id;
              return (
                <g key={r.account_id} onMouseEnter={() => setHover(r.account_id)} onClick={() => open(r.account_id)} style={{ cursor: "pointer" }}>
                  <rect x={0} y={cy - lane / 2} width={w} height={lane} fill={on ? pal.grid : "transparent"} />
                  {r.lead_months != null ? (
                    <>
                      <line x1={x(r.lead_months)} x2={x(0)} y1={cy} y2={cy} stroke={pal.shock} strokeWidth={on ? 4 : 3} strokeLinecap="round" strokeOpacity={hover == null || on ? 0.9 : 0.45} />
                      <circle cx={x(0)} cy={cy} r={on ? 3.5 : 2.5} fill={pal.critical} />
                    </>
                  ) : (
                    <circle cx={x(0)} cy={cy} r={on ? 3.5 : 2.5} fill="none" stroke={pal.neutral} strokeWidth={1.5} />
                  )}
                </g>
              );
            })}
          </svg>
        );
      }}</Sized>
      <p className="dumbbell-readout lanes-readout" aria-live="polite">
        {h ? (
          <>Account <strong>{h.account_id}</strong>: {h.lead_months != null
            ? <>first flagged in <strong>{monthLabel(h.first_flag!)}</strong>, <strong>{h.lead_months} months</strong> before the default on record ({monthLabel(h.known)}).</>
            : <>never flagged before the default on record ({monthLabel(h.known)}).</>} Click to replay it.</>
        ) : (
          <><strong>{flagged.length} of {rows.length}</strong> defaults were flagged ahead. Hover a lane for its story.</>
        )}
      </p>
    </ChartFrame>
  );
}
