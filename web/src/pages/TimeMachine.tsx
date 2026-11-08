import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { axisProps, cursorLine, gridProps, yAxisProps } from "../charts/common";
import { ChartFrame, DataTable, ErrorNote, Loading, Stat, TipBox } from "../components/ui";
import { money, monthLabel, shortMonth } from "../format";
import { usePalette } from "../theme";
import { Sized } from "../components/Sized";
import { useReveal } from "../motion";

const CAP = 24;
const fmt = (m: number) => (m >= 120 ? "120+ months" : `${m.toFixed(1)} months`);

export default function TimeMachine() {
  const pal = usePalette();
  const list = useQuery({ queryKey: ["tm-list"], queryFn: api.timeMachineList, staleTime: Infinity });
  const [id, setId] = useState<number | null>(null);
  const accountId = id ?? list.data?.customers[0]?.account_id ?? null;
  const tm = useQuery({ queryKey: ["tm", accountId], queryFn: () => api.timeMachine(accountId!), enabled: accountId != null, staleTime: Infinity });
  const [upto, setUpto] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { document.title = "Time machine, Toonie"; }, []);
  const pageRef = useRef<HTMLDivElement>(null);
  useReveal(pageRef, `${!!list.data}-${!!tm.data}`);

  const months = tm.data?.months ?? [];
  const last = months.length - 1;
  const idx = upto == null ? last : Math.min(upto, last);

  useEffect(() => { setUpto(null); setPlaying(false); }, [accountId]);
  useEffect(() => {
    if (!playing) return;
    if (idx >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setUpto(idx + 1), 260);
    return () => clearTimeout(t);
  }, [playing, idx, last]);

  const data = useMemo(() => months.map((m, i) => ({
    month: m.month,
    runway: i <= idx ? Math.min(m.runway, CAP) : null,
    runway_ei: i <= idx ? Math.min(m.runway_ei, CAP) : null,
    raw: m,
  })), [months, idx]);

  if (list.isError) return <ErrorNote error={list.error} onRetry={() => list.refetch()} />;
  if (!list.data) return <Loading what="customers with defaulted loans" />;

  const t = tm.data;
  const now = months[idx];
  const firstFlag = months.slice(0, idx + 1).find((m) => m.runway_ei < 2);
  const knownShown = t && months.findIndex((m) => m.month === t.known) <= idx && months.some((m) => m.month === t.known);

  return (
    <div className="pg" ref={pageRef}>
      <div className="page-head">
        <div>
          <h1>Time machine</h1>
          <p>Replay a customer whose loan defaulted, month by month, using only the data the bank had at the time.</p>
        </div>
      </div>

      <div className="pg-card pg-controls reveal">
        <label className="account-field">
          Customer with a defaulted loan
          <select className="select" value={accountId ?? ""} onChange={(e) => setId(Number(e.target.value))}>
            {list.data.customers.map((c) => (
              <option key={c.account_id} value={c.account_id}>
                {c.account_id}, {c.lead_months != null ? `warned ${c.lead_months} months ahead` : "not flagged"}
              </option>
            ))}
          </select>
        </label>
        {t && now && (
          <div className="replay">
            <button type="button" className="btn btn-primary" style={{ minWidth: 96 }}
                    onClick={() => { if (playing) setPlaying(false); else { if (idx >= last) setUpto(0); setPlaying(true); } }}>
              {playing ? "Pause" : idx >= last ? "Replay" : "Play"}
            </button>
            <label htmlFor="upto" className="sr-only">Replay up to month</label>
            <input id="upto" type="range" min={0} max={last} value={idx} aria-valuetext={monthLabel(now.month)}
                   onChange={(e) => { setPlaying(false); setUpto(Number(e.target.value)); }} />
            <span className="pg-month" aria-live="polite">{monthLabel(now.month)}</span>
          </div>
        )}
      </div>

      {tm.isError && <ErrorNote error={tm.error} onRetry={() => tm.refetch()} />}
      {!t && tm.isLoading && <Loading what="the replay" />}
      {t && now && (
        <>
          <div className={`pg-stats reveal${now.runway_ei < 2 ? " lead-first" : ""}`}>
            <Stat label="Runway then, on EI" value={fmt(now.runway_ei)} subTone={now.runway_ei < 2 ? "bad" : undefined}
                  sub={now.runway_ei < 2 ? "under the 2-month line" : "above the 2-month line"} />
            <Stat label="Runway then, no shock" value={fmt(now.runway)} />
            <Stat label="Early warning" value={firstFlag ? `Since ${monthLabel(firstFlag.month)}` : "Not yet"} sub="fires under 2 months on EI" />
            <Stat label="Default on record" value={monthLabel(t.known)} sub={t.status === "B" ? "loan finished unpaid" : "running loan in debt"} />
            <Stat label="Buffer then" value={money(now.buffer)} />
          </div>

          <section className="section reveal" aria-label="Runway month by month">
            <div className="pg-card">
            <ChartFrame title="What the engine would have shown each month" sub={`Runway capped at ${CAP} months so the fall is visible`}
                        legend={[{ label: "Runway, no shock", color: pal.today, shape: "line" }, { label: "Runway on EI (stress test)", color: pal.shock, shape: "line" }]}
                        table={<DataTable caption="Runway month by month" rows={months.slice(0, idx + 1)} maxHeight={360} columns={[
                          { key: "m", label: "Month", render: (m) => shortMonth(m.month) },
                          { key: "r", label: "No shock", align: "r", render: (m) => fmt(m.runway) },
                          { key: "e", label: "On EI", align: "r", render: (m) => fmt(m.runway_ei) },
                          { key: "b", label: "Buffer", align: "r", render: (m) => money(m.buffer) },
                        ]} />}>
              <Sized height={360}>{(w) => (
                <LineChart width={w} height={360} data={data} margin={{ top: 26, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps(pal)} />
                  <XAxis dataKey="month" {...axisProps(pal)} tickFormatter={shortMonth} minTickGap={28} />
                  <YAxis {...yAxisProps(pal)} domain={[0, CAP + 1]} ticks={[0, 2, 6, 12, 18, 24]} width={36} />
                  <Tooltip cursor={cursorLine(pal)} content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const raw = (payload[0].payload as typeof data[number]).raw;
                    if ((payload[0].payload as typeof data[number]).runway == null) return null;
                    return <TipBox title={monthLabel(String(label))} rows={[
                      { label: "On EI", value: fmt(raw.runway_ei), color: pal.shock },
                      { label: "No shock", value: fmt(raw.runway), color: pal.today },
                    ]} />;
                  }} />
                  <ReferenceLine y={2} stroke={pal.critical} strokeDasharray="5 4"
                                 label={{ value: "Warning line: 2 months on EI", position: "insideTopRight", fill: pal.critical, fontSize: 12 }} />
                  <ReferenceLine x={t.loan_start} stroke={pal.ink2}
                                 label={{ value: "Loan starts", position: "top", fill: pal.ink2, fontSize: 12 }} />
                  {knownShown && <ReferenceLine x={t.known} stroke={pal.critical}
                                                label={{ value: "Default on record", position: "top", fill: pal.critical, fontSize: 12 }} />}
                  <Line dataKey="runway" stroke={pal.today} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false}
                        activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2 }} />
                  <Line dataKey="runway_ei" stroke={pal.shock} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false}
                        activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2 }} />
                </LineChart>
              )}</Sized>
            </ChartFrame>
            <p className="fine">
              For a live version, run <code>python replay.py --account &lt;id&gt; --from &lt;YYYY-MM&gt;</code> with Tiger Data and turn on
              Follow live feed on the Customer page. Each month lands in the hypertable and the continuous aggregate moves the numbers within a second.
            </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
