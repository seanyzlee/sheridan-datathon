import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { ApiError } from '../api/client';
import s from './ui.module.css';

export function Card({
  title,
  tag,
  sub,
  actions,
  busy,
  children,
  className,
  style,
  id,
}: {
  title: ReactNode;
  tag?: string;
  sub?: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  return (
    <section className={`${s.card} ${className ?? ''}`} style={style} aria-busy={busy || undefined} id={id}>
      {busy && <div className={s.busy} aria-hidden />}
      <header className={s.cardHead}>
        <div>
          <h2 className={s.cardTitle}>
            {title}
            {tag && <span className={s.cardTag}>{tag}</span>}
          </h2>
          {sub && <p className={s.cardSub}>{sub}</p>}
        </div>
        {actions && <div className={s.cardActions}>{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Skeleton({ h = 16, w = '100%', style }: { h?: number | string; w?: number | string; style?: CSSProperties }) {
  return <div className={s.skeleton} style={{ height: h, width: w, ...style }} aria-hidden />;
}

export function SkeletonBlock({ lines = 3, chart = 0 }: { lines?: number; chart?: number }) {
  return (
    <div style={{ display: 'grid', gap: 8 }} aria-label="Loading">
      {chart > 0 && <Skeleton h={chart} />}
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} h={12} w={`${90 - i * 18}%`} />
      ))}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const msg =
    error instanceof ApiError
      ? error.code === 'bad_response'
        ? `The engine returned data in an unexpected shape (${error.field}).`
        : error.message
      : 'Something went wrong loading this panel.';
  return (
    <div className={s.error} role="alert">
      <span aria-hidden>⚠</span>
      <span>{msg}</span>
    </div>
  );
}

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'accent';

export function Badge({ tone = 'neutral', dot, live, children, title }: { tone?: Tone; dot?: boolean; live?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={s.badge} data-tone={tone} title={title}>
      {dot && <span className={`${s.dot} ${live ? s.dotLive : ''}`} aria-hidden />}
      {children}
    </span>
  );
}

export function Button({
  variant = 'default',
  size,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost'; size?: 'sm' }) {
  return <button type="button" className={s.button} data-variant={variant} data-size={size} {...rest} />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={s.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, valueStyle }: { label: ReactNode; value: ReactNode; hint?: ReactNode; valueStyle?: CSSProperties }) {
  return (
    <div>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue} style={valueStyle}>
        {value}
      </div>
      {hint && <div className={s.statHint}>{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className={s.empty}>{children}</p>;
}
