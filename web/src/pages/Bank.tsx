import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Bank as BankT } from "../api";
import { anim, axisProps, cursorBand, gridProps, MARGIN, yAxisProps } from "../charts/common";
import { ChartFrame, DataTable, ErrorNote, Loading, SectionHead, Stat, TipBox } from "../components/ui";
import { describeShock, money, pct, signedPct } from "../format";
import { useAdvanced, useAppState, useDebounced } from "../state";
import { usePalette } from "../theme";
import { Sized } from "../components/Sized";
import { useReveal } from "../motion";

// three.js is only downloaded when the surface is on screen.
const StressSurface = lazy(() => import("../charts/StressSurface"));

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

function SurfaceSection({ shock, simple }: { shock: import("../api").Shock; simple: boolean }) {
  const pal = usePalette();
  const { patchShock } = useAppState();
  const s = useDebounced(shock, 200);
  const q = useQuery({ queryKey: ["surface", s], queryFn: () => api.surface(s), placeholderData: keepPreviousData, staleTime: Infinity });
  const gl = useMemo(webglAvailable, []);
  const d = q.data;
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  if (!d) return <Loading what="the stress surface" />;
  const markerLabel = `This shock: ${pct(d.marker.under3, 1)}`;
  const table = (
    <DataTable caption="Share of customers under 3 months by income kept and bills increase" maxHeight={380}
               rows={d.income.map((inc, i) => ({ inc, row: d.under3[i] }))}
               columns={[
                 { key: "i", label: "Income kept", render: (r) => `${r.inc}%` },
                 ...d.bills.filter((b) => b % 10 === 0).map((b) => ({
                   key: `b${b}`, label: `Bills +${b}%`, align: "r" as const,
                   render: (r: { inc: number; row: number[] }) => pct(r.row[d.bills.indexOf(b)], 1),
                 })),
               ]} />
  );
  return (
    <ChartFrame
      title={simple ? "Where the bank tips over" : "The stress surface"}
      sub={<>
        {simple
          ? `How many of our ${d.customers.toLocaleString("en-CA")} customers would have under 3 months of savings, for every mix of lost income and higher bills. Drag to turn it; click a point to try that what-if.`
          : `Share of all ${d.customers.toLocaleString("en-CA")} customers under 3 months of runway (judges' formula) for every income × bills shock, ${d.income.length * d.bills.length} scenarios in ${(d.seconds * 1000).toFixed(0)} ms. Drag to orbit, scroll to zoom, click to apply.`}
        {d.held.length > 0 && ` Held at the current shock: ${d.held.join(", ")}.`}
      </>}
      legend={[
        { label: "Employed (income 100%)", color: pal.today, shape: "line" },
        { label: "On EI (income 55%)", color: pal.shock, shape: "line" },
        { label: "This shock", color: pal.ink, shape: "dashed" },
      ]}
      table={table} stale={q.isPlaceholderData || s !== shock} interactive
      label={`3D surface of the share of customers under 3 months by income kept and bills increase. It rises from ${pct(d.under3[0][0], 1)} with no shock to ${pct(d.max, 1)} with no income and bills up 50%. This shock: ${pct(d.marker.under3, 1)}.`}>
      {gl ? (
        <Suspense fallback={<div className="surface-wrap"><Loading what="the 3D view" /></div>}>
          <StressSurface s={d} markerLabel={markerLabel}
                         onPick={(income, bills) => patchShock({ income_factor: income / 100, bills_pct: bills / 100 })} />
        </Suspense>
      ) : (
        <div className="callout info">This browser can't show 3D graphics. Use Show table for the same numbers.</div>
      )}
      <div className="heat-scale">
        <span>{pct(0)}</span>
        <span className="heat-scale-bar">{pal.heat.map((c) => <span key={c} style={{ background: c }} />)}</span>
        <span>{pct(Math.max(0.05, Math.ceil(d.max / (d.max > 0.3 ? 0.1 : 0.05)) * (d.max > 0.3 ? 0.1 : 0.05)))}</span>
        <span style={{ marginLeft: 8 }}>Share under 3 months. Taller is worse; colour follows height.</span>
      </div>
    </ChartFrame>
  );
}

function Histogram({ b, stale, simple }: { b: BankT; stale: boolean; simple?: boolean }) {
  const pal = usePalette();
  // The red zone: the bars for 0 to 3 months, labelled with the server's own share under 3 months.
  const zone = b.histogram.filter((d) => d.months < 3);
  const table = (
    <DataTable caption="Customers by months of runway" rows={b.histogram} maxHeight={340} columns={[
      { key: "m", label: "Months of runway", render: (d) => (d.months === 36 ? "36 or more" : `${d.months} to ${d.months + 1}`) },
      { key: "n", label: "Customers", align: "r", render: (d) => (d.under3 + d.over3).toLocaleString("en-CA") },
    ]} />
  );
  return (
    <ChartFrame title={simple ? "How long savings last, customer by customer" : "Runway across every customer"}
                sub={simple ? "Number of customers by months their savings would last; 36 or more at the right" : "Customers by months of runway; 36 or more grouped at the right"}
                legend={[{ label: "Under 3 months", color: pal.critical }, { label: "3 months or more", color: pal.today }]}
                table={table} stale={stale} label="Histogram of runway across all customers under this shock">
      <Sized height={300}>{(w) => (
        <BarChart width={w} height={300} data={b.histogram} margin={{ ...MARGIN, top: 26 }} barCategoryGap={2}>
          <CartesianGrid {...gridProps(pal)} />
          {zone.length > 0 && (
            <ReferenceArea x1={zone[0].label} x2={zone[zone.length - 1].label} fill={pal.critical} fillOpacity={0.07} stroke="none" ifOverflow="visible"
                           label={{ value: `${pct(b.kpis.under3, 1)} under 3 months`, position: "insideTopLeft", fill: pal.ink, fontSize: 12, fontWeight: 650, dy: -22 }} />
          )}
          <XAxis dataKey="label" {...axisProps(pal)} interval={5} height={36} />
          <YAxis {...yAxisProps(pal)} width={48} />
          <Tooltip cursor={cursorBand(pal)} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as BankT["histogram"][number];
            return <TipBox title={d.months === 36 ? "36+ months" : `${d.months} to ${d.months + 1} months`}
                           rows={[{ label: "Customers", value: (d.under3 + d.over3).toLocaleString("en-CA"), color: d.months < 3 ? pal.critical : pal.today, shape: "rect" }]} />;
          }} />
          <Bar dataKey="under3" stackId="h" fill={pal.critical} radius={[3, 3, 0, 0]} {...anim()} />
          <Bar dataKey="over3" stackId="h" fill={pal.today} radius={[3, 3, 0, 0]} {...anim()} />
        </BarChart>
      )}</Sized>
    </ChartFrame>
  );
}

// Text on a heat cell: white or near-black, whichever contrasts more with the fill (WCAG relative luminance).
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function readableInk(bg: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return "inherit";
  const L = luminance(bg);
  return (1.05) / (L + 0.05) >= (L + 0.05) / (0.0024 + 0.05) ? "#ffffff" : "#06090d";
}

function Heatmap({ b, stale }: { b: BankT; stale: boolean }) {
  const pal = usePalette();
  const max = Math.max(0.0001, ...b.heatmap.map((h) => h.share ?? 0));
  const color = (v: number | null) => {
    if (v == null) return pal.grid;
    const i = Math.min(pal.heat.length - 1, Math.floor((v / max) * (pal.heat.length - 0.001)));
    return pal.heat[i];
  };
  const ink = (v: number | null) => readableInk(color(v));
  const cell = (region: string, band: string) => b.heatmap.find((h) => h.region === region && h.band === band);
  const table = (
    <DataTable caption="Share under 3 months by region and income band" rows={b.regions} columns={[
      { key: "r", label: "Region", render: (r) => r },
      ...b.bands.map((band) => ({ key: band, label: band, align: "r" as const, render: (r: string) => pct(cell(r, band)?.share ?? null) })),
    ]} />
  );
  return (
    <ChartFrame title="Who falls under 3 months" sub="Share of customers, by region and income band" table={table} stale={stale}
                label="Heatmap of the share of customers under 3 months by region and income band">
      <div className="pg-heat-scroll">
      <div className="heat" style={{ gridTemplateColumns: `minmax(72px, 140px) repeat(${b.bands.length}, minmax(38px, 1fr))` }}>
        {b.regions.map((region) => (
          <div key={region} style={{ display: "contents" }}>
            <div className="heat-row-label" title={region}>{region}</div>
            {b.bands.map((band) => {
              const c = cell(region, band);
              const v = c?.share ?? null;
              return (
                <div key={band} className="heat-cell" tabIndex={0} style={{ background: color(v), color: ink(v) }}
                     title={`${region}, ${band} income: ${pct(v)} of ${c?.n ?? 0} customers under 3 months`}
                     aria-label={`${region}, ${band} income: ${pct(v)} under 3 months`}>
                  {pct(v)}
                </div>
              );
            })}
          </div>
        ))}
        <div />
        {b.bands.map((band) => <div key={band} className="heat-col-label">{band}</div>)}
      </div>
      </div>
      <div className="heat-scale">
        <span>0%</span>
        <span className="heat-scale-bar">{pal.heat.map((c) => <span key={c} style={{ background: c }} />)}</span>
        <span>{pct(max)}</span>
        <span style={{ marginLeft: 8 }}>Columns run from lowest to highest earners.</span>
      </div>
    </ChartFrame>
  );
}

// A tile map of the 8 regions, laid out roughly where they sit (Bohemia west, Moravia east, Prague inside
// central Bohemia). Tiles rather than borders: honest at this level and easy to read. Shares are the server's.
const REGION_TILES: Record<string, [number, number]> = {
  "north Bohemia": [1, 0], "east Bohemia": [2, 0], "north Moravia": [3, 0],
  "west Bohemia": [0, 1], "Prague": [1, 1], "central Bohemia": [2, 1], "south Moravia": [3, 1],
  "south Bohemia": [1, 2],
};

function RegionTiles({ b, stale, simple }: { b: BankT; stale: boolean; simple?: boolean }) {
  const pal = usePalette();
  const rows = b.regions_under3;
  const max = Math.max(0.0001, ...rows.map((r) => r.share));
  const color = (v: number) => pal.heat[Math.min(pal.heat.length - 1, Math.floor((v / max) * (pal.heat.length - 0.001)))];
  const worst = rows.reduce((a, r) => (r.share > a.share ? r : a), rows[0]);
  const table = (
    <DataTable caption="Share under 3 months by region" rows={rows} columns={[
      { key: "r", label: "Region", render: (r) => r.region },
      { key: "s", label: "Under 3 months", align: "r", render: (r) => pct(r.share, 1) },
      { key: "n", label: "Customers", align: "r", render: (r) => r.n.toLocaleString("en-CA") },
    ]} />
  );
  return (
    <ChartFrame title={simple ? "Where they live" : "By region"}
                sub={simple ? "Share of customers in each region whose savings would last under 3 months" : `Share under 3 months in each region, laid out roughly as a map. Highest: ${worst?.region} (${pct(worst?.share, 1)})`}
                table={table} stale={stale} label={`Tile map of the share under 3 months by region: ${rows.map((r) => `${r.region} ${pct(r.share, 1)}`).join(", ")}`}>
      <div className="tiles" aria-hidden>
        {rows.map((r) => {
          const pos = REGION_TILES[r.region];
          if (!pos) return null;
          const bg = color(r.share);
          return (
            <div key={r.region} className={`tile${r.region === worst?.region ? " worst" : ""}`}
                 style={{ gridColumn: pos[0] + 1, gridRow: pos[1] + 1, background: bg, color: readableInk(bg) }}
                 title={`${r.region}: ${pct(r.share, 1)} of ${r.n.toLocaleString("en-CA")} customers under 3 months`}>
              <span className="tile-name">{r.region}</span>
              <strong className="tile-value">{pct(r.share, 1)}</strong>
              <span className="tile-n">{r.n.toLocaleString("en-CA")} customers</span>
            </div>
          );
        })}
      </div>
      <div className="heat-scale">
        <span>0%</span>
        <span className="heat-scale-bar">{pal.heat.map((c) => <span key={c} style={{ background: c }} />)}</span>
        <span>{pct(max, 1)}</span>
        <span style={{ marginLeft: 8 }}>Bohemia to the west, Moravia to the east.</span>
      </div>
    </ChartFrame>
  );
}

function HowToRead({ b }: { b: BankT }) {
  const pal = usePalette();
  return (
    <section className="pg-card pg-guide" aria-labelledby="bank-guide">
      <h2 id="bank-guide">How to read this</h2>
      <ul>
        <li><span className="pg-swatch" style={{ background: pal.critical }} aria-hidden />
          <span><strong>Red bars</strong> are customers whose savings would run out in under 3 months. They need a call first.</span></li>
        <li><span className="pg-swatch" style={{ background: pal.today }} aria-hidden />
          <span><strong>Blue bars</strong> are customers with 3 months or more to adjust.</span></li>
        <li><span className="pg-swatch" style={{ background: pal.today, opacity: 0.45 }} aria-hidden />
          <span><strong>The tall bar on the right</strong> groups everyone with 36 months or more: well protected.</span></li>
        <li><span className="pg-swatch" style={{ background: pal.shock }} aria-hidden />
          <span>Change the what-if in the panel and every one of the {b.customers.toLocaleString("en-CA")} customers is recalculated.</span></li>
      </ul>
    </section>
  );
}

export default function Bank() {
  const { shock, setAccountId, setView } = useAppState();
  const advanced = useAdvanced();
  const navigate = useNavigate();
  const s = useDebounced(shock, 200);
  const q = useQuery({ queryKey: ["bank", s], queryFn: () => api.bank(s), placeholderData: keepPreviousData, staleTime: Infinity });
  useEffect(() => { document.title = "Whole bank, Toonie"; }, []);
  const pageRef = useRef<HTMLDivElement>(null);

  const b = q.data;
  const stale = q.isPlaceholderData || s !== shock;
  useReveal(pageRef, `${!!b}-${advanced}`);
  const moved = b ? Math.abs(b.kpis.under3 - b.kpis.under3_base) >= 0.0005 : false;
  return (
    <div className="pg" ref={pageRef}>
      <div className="page-head">
        <div>
          <h1>{advanced ? "The whole bank under this shock" : "Every customer, under this what-if"}</h1>
          <p>{describeShock(shock)}. {advanced
            ? `Every one of the ${b?.customers.toLocaleString("en-CA") ?? "4,500"} customers, rerun on every change.`
            : `How many of our ${b?.customers.toLocaleString("en-CA") ?? "4,500"} customers would be in trouble.`}</p>
        </div>
      </div>
      {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {!b && q.isLoading && <Loading what="all 4,500 customers" />}
      {b && (
        <>
          {!advanced && (
            <div className="pg-headline reveal" style={{ opacity: stale ? 0.6 : undefined }} aria-live="polite">
              <div className="pg-headline-big">{pct(b.kpis.under3, 1)}</div>
              <p>of our customers would have savings that last under 3 months.
                <span>{moved ? `With no shock it would be ${pct(b.kpis.under3_base, 1)}.` : "The same as with no shock."}</span></p>
            </div>
          )}
          <div className={`pg-stats reveal${advanced ? " lead-first" : ""}${stale ? " stale" : ""}`}>
            {advanced && <Stat label="Under 3 months of runway" value={pct(b.kpis.under3, 1)}
                  sub={moved ? `${signedPct(b.kpis.under3 - b.kpis.under3_base)} vs no shock` : "same as with no shock"}
                  subTone={b.kpis.under3 > b.kpis.under3_base + 0.0005 ? "bad" : undefined} />}
            <Stat label="Already out of money" value={pct(b.kpis.out_of_money, 1)} sub={advanced ? "buffer gone after the one-off" : "nothing left to fall back on"} />
            <Stat label={`Expected to run out within ${b.target} months`} value={pct(b.kpis.expected_run_out, 1)} sub={advanced ? "average simulated chance" : "across thousands of possible futures"} />
            {advanced && <Stat label="More likely than not to run out" value={pct(b.kpis.likely_run_out, 1)} sub="survival under 50%" />}
            {advanced && <Stat label="Compute time" value={`${b.seconds.toFixed(2)} s`}
                  sub={`${((b.customers * b.paths * b.months) / 1e6).toFixed(0)}M simulated months, ${b.backend}`} />}
          </div>

          <section className="section reveal" aria-label={advanced ? "Runway and who falls under 3 months" : "How long savings last"}>
            {advanced ? (
              <div className="pg-grid">
                <div className="pg-card"><Histogram b={b} stale={stale} /></div>
                <div className="pg-card"><Heatmap b={b} stale={stale} /></div>
              </div>
            ) : (
              <div className="pg-grid wide-left">
                <div className="pg-card"><Histogram b={b} stale={stale} simple /></div>
                <HowToRead b={b} />
              </div>
            )}
          </section>

          <section className="section reveal" aria-label="By region">
            <div className="pg-card"><RegionTiles b={b} stale={stale} simple={!advanced} /></div>
          </section>

          <section className="section reveal" aria-label="Stress surface">
            <div className="pg-card"><SurfaceSection shock={shock} simple={!advanced} /></div>
          </section>

          {!advanced && (
            <p className="advanced-hint">
              Want the breakdown by region and income, and the list of the most fragile customers?
              <button type="button" className="btn" onClick={() => setView("advanced")}>Switch to advanced view</button>
            </p>
          )}
          {advanced && <section className="section reveal">
            <SectionHead title="The most fragile customers">Lowest chance of making it, then shortest runway. Select a row to open the customer.</SectionHead>
            <div className="pg-card flush" style={{ opacity: stale ? 0.6 : 1 }}>
              <DataTable caption="The 25 most fragile customers under this shock" rows={b.worst}
                         onRowClick={(r) => { setAccountId(r.account_id); navigate({ pathname: "/", search: window.location.search.replace(/account=\d+/, `account=${r.account_id}`) }); }}
                         columns={[
                           { key: "a", label: "Account", render: (r) => <span className="num">{r.account_id}</span> },
                           { key: "d", label: "District", render: (r) => r.district_name },
                           { key: "rg", label: "Region", render: (r) => r.region },
                           { key: "i", label: "Income", align: "r", render: (r) => money(r.I) },
                           { key: "s", label: "Spending", align: "r", render: (r) => money(r.S) },
                           { key: "b", label: "Buffer", align: "r", render: (r) => money(r.B) },
                           { key: "rw", label: "Runway", align: "r", render: (r) => (r.no_shortfall ? "120+" : r.runway.toFixed(1)) },
                           { key: "sv", label: `Chance of making ${b.target} months`, render: (r) => (
                             <span className="meter"><span className="meter-track"><span className="meter-fill" style={{ width: `${r.survival * 100}%` }} /></span><span className="num">{pct(r.survival)}</span></span>
                           ) },
                         ]} />
            </div>
          </section>}
        </>
      )}
    </div>
  );
}
