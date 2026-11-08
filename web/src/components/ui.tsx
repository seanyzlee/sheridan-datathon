import { useId, useState, type ReactNode } from "react";
import { ApiError } from "../api";

// --------------------------------------------------------------------------- legend keys

export type KeyShape = "rect" | "line" | "dashed" | "band";
export interface LegendEntry { label: string; color: string; shape?: KeyShape }

export function Key({ color, shape = "rect" }: { color: string; shape?: KeyShape }) {
  if (shape === "line" || shape === "dashed") return <span className={`key-line${shape === "dashed" ? " dashed" : ""}`} style={{ borderColor: color }} aria-hidden />;
  if (shape === "band") return <span className="key-band" style={{ background: color }} aria-hidden />;
  return <span className="key-rect" style={{ background: color }} aria-hidden />;
}

export function Legend({ items }: { items: LegendEntry[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span className="legend-item" key={it.label}><Key color={it.color} shape={it.shape} />{it.label}</span>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------- table view

export interface Column<T> { key: string; label: string; align?: "r"; render: (row: T) => ReactNode }

export function DataTable<T>({ columns, rows, caption, onRowClick, maxHeight }: {
  columns: Column<T>[]; rows: T[]; caption?: string; onRowClick?: (row: T) => void; maxHeight?: number;
}) {
  // The wrapper can scroll (wide tables on phones, tall ones with maxHeight), so it is a focusable,
  // labelled region: keyboard users can scroll it with the arrow keys.
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
         tabIndex={0} role="region" aria-label={caption ?? "Table"}>
      <table className="data">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.align} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={onRowClick ? "clickable" : undefined}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(r); } } : undefined}
                tabIndex={onRowClick ? 0 : undefined}>
              {columns.map((c) => <td key={c.key} className={c.align}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --------------------------------------------------------------------------- chart frame

/** Title, legend, the chart, and a table-view twin (every value is reachable without hovering). */
export function ChartFrame({ title, sub, legend, table, stale, children, label, interactive }: {
  title: string; sub?: ReactNode; legend?: LegendEntry[]; table?: ReactNode; stale?: boolean; children: ReactNode; label?: string;
  /** The chart holds its own controls (buttons, sliders, focusable marks): a labelled group, not a single image. */
  interactive?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  return (
    <figure className="chart" style={{ margin: 0 }} aria-labelledby={id}>
      <div className="chart-head">
        <div>
          <div className="chart-title" id={id}>{title}</div>
          {sub && <div className="chart-sub">{sub}</div>}
        </div>
        {table && (
          <button type="button" className="btn btn-quiet table-toggle" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Show chart" : "Show table"}
          </button>
        )}
      </div>
      {legend && legend.length > 1 && !showTable && <Legend items={legend} />}
      <div className={`chart-body${stale ? " stale" : ""}`} role={showTable ? undefined : interactive ? "group" : "img"} aria-label={showTable ? undefined : label ?? title}>
        {showTable ? table : children}
      </div>
    </figure>
  );
}

// --------------------------------------------------------------------------- tooltip

export interface TipRow { label: string; value: string; color?: string; shape?: KeyShape }

export function TipBox({ title, rows }: { title?: string; rows: TipRow[] }) {
  return (
    <div className="tooltip">
      {title && <div className="tooltip-title">{title}</div>}
      {rows.map((r) => (
        <div className="tooltip-row" key={r.label}>
          <span className="left">{r.color && <Key color={r.color} shape={r.shape ?? "line"} />}{r.label}</span>
          <span className="val">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------- stats

export function Stat({ label, abbr, value, sub, subTone, title }: {
  label: string; abbr?: string; value: ReactNode; sub?: ReactNode; subTone?: "good" | "bad"; title?: string;
}) {
  return (
    <div className="stat" title={title}>
      <span className="stat-label">{label}{abbr && <abbr title={title}>{abbr}</abbr>}</span>
      <span className="stat-value">{value}</span>
      {sub != null && <span className={`stat-sub${subTone ? ` ${subTone}` : ""}`}>{sub}</span>}
    </div>
  );
}

// --------------------------------------------------------------------------- states

export function Loading({ what }: { what: string }) {
  return <div className="loading" role="status"><div className="loading-bar" aria-hidden />Loading {what}…</div>;
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError || error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="callout error" role="alert">
      <span aria-hidden>!</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span>{msg}</span>
        {onRetry && <button type="button" className="btn" style={{ width: "fit-content" }} onClick={onRetry}>Try again</button>}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
  return (
    <label className="switch" title={help}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden />
    </label>
  );
}

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
