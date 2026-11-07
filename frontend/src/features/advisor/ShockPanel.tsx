import { forwardRef, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import { Badge, Button, Card, Segmented } from '../../components/ui';
import { featureOn } from '../../lib/config';
import { cad } from '../../lib/format';
import { NO_DRAFT, oneOffCad, PRESETS, sameDraft, type ShockDraft } from '../../lib/shock';
import { readTwist, type TwistField, type TwistResult } from '../../lib/twistReader';
import { useScenarioState } from '../../state/scenario';
import s from './advisor.module.css';

function Slider({
  id,
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  changed,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  changed: boolean;
  hint?: string;
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <div className={s.control}>
      <div className={s.controlHead}>
        <label htmlFor={id}>{label}</label>
        <span className={s.controlValue} data-changed={changed}>
          {display}
        </span>
      </div>
      <input
        id={id}
        className={s.range}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--fill': fill } as CSSProperties}
        aria-valuetext={display}
      />
      {hint && <span className={s.toggleHint}>{hint}</span>}
    </div>
  );
}

const FIELD_LABEL: Record<TwistField, string> = {
  income_factor: 'Income kept',
  income_months: 'EI length',
  bills_pct: 'Bills',
  spend_delta: 'Rent / other',
  one_off: 'One-off',
  ei_cap_on: 'EI cap',
};

export interface TwistReaderHandle {
  focus: () => void;
}

const TwistReader = forwardRef<TwistReaderHandle, { S: number | undefined; onApply: (d: ShockDraft) => void }>(function TwistReader({ S, onApply }, ref) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<TwistResult | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => box.current?.focus() }));

  const read = () => setResult(readTwist(text));
  const apply = () => {
    if (!result?.recognised) return;
    onApply(result.draft);
    setResult(null);
  };

  return (
    <div className={s.twistBox}>
      <div className={s.twistLabel}>
        <label htmlFor="twist-text">Twist card reader</label>
        <span>
          <kbd>/</kbd>
        </span>
      </div>
      <textarea
        id="twist-text"
        ref={box}
        className={s.twistInput}
        placeholder="Paste the twist card, e.g. “EI 55% for 6 months and rent up $300”"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (result?.recognised) apply();
            else read();
          }
          if (e.key === 'Escape') setResult(null);
        }}
        rows={2}
      />
      {!result && (
        <Button size="sm" variant="primary" onClick={read} disabled={!text.trim()}>
          Read twist
        </Button>
      )}
      {result && (
        <div className={s.parsed} aria-live="polite">
          {!result.recognised ? (
            <span className={s.unmatched}>No shock recognised. Set the sliders by hand.</span>
          ) : (
            <>
              {result.matches.map((m, i) => (
                <div key={i} className={s.parsedRow}>
                  <span className={s.parsedField}>{FIELD_LABEL[m.field]}</span>
                  <span className={s.parsedValue}>
                    {m.value}
                    {m.field === 'one_off' && result.draft.one_off_mode === 'xs' && S !== undefined && ` = ${cad(oneOffCad(result.draft, S))}`}
                    <span className={s.parsedPhrase}>from “{m.phrase}”</span>
                  </span>
                </div>
              ))}
              <span className={s.parsedNote}>Anything not listed resets to no shock.</span>
            </>
          )}
          {result.unmatched.length > 0 && <span className={s.unmatched}>Not understood: “{result.unmatched.join('”, “')}”. Set it by hand.</span>}
          <div className={s.inlineInputs}>
            <Button size="sm" variant="primary" onClick={apply} disabled={!result.recognised}>
              Apply to sliders
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
              Edit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

export interface ShockPanelHandle {
  focusTwist: () => void;
}

export const ShockPanel = forwardRef<ShockPanelHandle, { S: number | undefined; busy: boolean }>(function ShockPanel({ S, busy }, ref) {
  const { draft, setDraft } = useScenarioState();
  const twist = useRef<TwistReaderHandle>(null);
  useImperativeHandle(ref, () => ({ focusTwist: () => twist.current?.focus() }));

  const set = (patch: Partial<ShockDraft>) => setDraft({ ...draft, ...patch });
  const activePreset = PRESETS.find((p) => sameDraft(p.draft, draft));
  const isReset = sameDraft(draft, NO_DRAFT);
  const oneOffMax = draft.one_off_mode === 'xs' ? 6 : 20_000;

  return (
    <Card
      title="Shock"
      busy={busy}
      actions={
        <Button size="sm" variant="ghost" onClick={() => setDraft(NO_DRAFT)} disabled={isReset} title="Reset (0)">
          Reset
        </Button>
      }
    >
      {featureOn('twist-reader') && <TwistReader ref={twist} S={S} onApply={setDraft} />}

      <div className={s.presets} role="group" aria-label="Example twist cards">
        {PRESETS.map((p, i) => (
          <button key={p.id} type="button" className={s.preset} aria-pressed={activePreset?.id === p.id} onClick={() => setDraft(p.draft)} title={`${p.card} (${i + 1})`}>
            <span className={s.presetTitle}>
              <kbd>{i + 1}</kbd> {p.title}
            </span>
            <span className={s.presetCard}>{p.card}</span>
          </button>
        ))}
      </div>

      <div className={s.divider} />

      <Slider
        id="income"
        label="Income kept"
        value={Math.round(draft.income_factor * 100)}
        display={draft.income_factor === 0.55 ? '55% · EI' : `${Math.round(draft.income_factor * 100)}%`}
        min={0}
        max={100}
        step={1}
        changed={draft.income_factor !== 1}
        onChange={(v) => set({ income_factor: v / 100 })}
      />
      <Slider
        id="ei-months"
        label="EI length"
        value={draft.income_months}
        display={draft.income_months === 0 ? 'Not set' : `${draft.income_months} months`}
        min={0}
        max={24}
        step={1}
        changed={draft.income_months !== 0}
        onChange={(v) => set({ income_months: v })}
        hint="For the verdict and simulation only, not the runway"
      />
      <Slider
        id="bills"
        label="Bills increase"
        value={Math.round(draft.bills_pct * 100)}
        display={`+${Math.round(draft.bills_pct * 100)}% of H`}
        min={0}
        max={100}
        step={1}
        changed={draft.bills_pct !== 0}
        onChange={(v) => set({ bills_pct: v / 100 })}
      />

      <div className={s.control}>
        <div className={s.controlHead}>
          <label htmlFor="spend-delta">Rent / other, per month</label>
          <span className={s.controlValue} data-changed={draft.spend_delta !== 0}>
            +{cad(draft.spend_delta)}
          </span>
        </div>
        <div className={s.inlineInputs}>
          <input
            className={s.range}
            type="range"
            min={0}
            max={3000}
            step={25}
            value={Math.min(draft.spend_delta, 3000)}
            onChange={(e) => set({ spend_delta: Number(e.target.value) })}
            style={{ '--fill': `${(Math.min(draft.spend_delta, 3000) / 3000) * 100}%` } as CSSProperties}
            aria-label="Rent or other monthly increase slider"
          />
          <input
            id="spend-delta"
            className={s.numInput}
            style={{ width: 84 }}
            type="number"
            min={0}
            max={20000}
            step={25}
            value={draft.spend_delta}
            onChange={(e) => set({ spend_delta: Math.max(0, Math.min(20000, Number(e.target.value) || 0)) })}
          />
        </div>
      </div>

      <div className={s.control}>
        <div className={s.controlHead}>
          <label htmlFor="one-off">One-off cost</label>
          <Segmented
            label="One-off unit"
            value={draft.one_off_mode}
            options={[
              { value: 'cad', label: '$' },
              { value: 'xs', label: '× S' },
            ]}
            onChange={(m) => {
              if (m === draft.one_off_mode) return;
              // Convert so the CAD amount doesn't jump when switching units.
              const cadNow = S ? oneOffCad(draft, S) : 0;
              set(m === 'xs' ? { one_off_mode: 'xs', one_off_value: S ? Math.round((cadNow / S) * 10) / 10 : 0 } : { one_off_mode: 'cad', one_off_value: Math.round(cadNow) });
            }}
          />
        </div>
        <div className={s.inlineInputs}>
          <input
            className={s.range}
            type="range"
            min={0}
            max={oneOffMax}
            step={draft.one_off_mode === 'xs' ? 0.1 : 50}
            value={Math.min(draft.one_off_value, oneOffMax)}
            onChange={(e) => set({ one_off_value: Number(e.target.value) })}
            style={{ '--fill': `${(Math.min(draft.one_off_value, oneOffMax) / oneOffMax) * 100}%` } as CSSProperties}
            aria-label="One-off cost slider"
          />
          <input
            id="one-off"
            className={s.numInput}
            style={{ width: 84 }}
            type="number"
            min={0}
            step={draft.one_off_mode === 'xs' ? 0.1 : 50}
            value={draft.one_off_value}
            onChange={(e) => set({ one_off_value: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
        {draft.one_off_mode === 'xs' && <span className={s.equiv}>= {S !== undefined ? cad(oneOffCad(draft, S)) : '…'} for this customer</span>}
      </div>

      <div className={s.toggleRow}>
        <div>
          <label id="ei-cap-label">EI weekly maximum</label>
          <div className={s.toggleHint}>Cap EI income at $729/week (D8)</div>
        </div>
        <button type="button" role="switch" aria-checked={draft.ei_cap_on} aria-labelledby="ei-cap-label" className={s.switch} onClick={() => set({ ei_cap_on: !draft.ei_cap_on })} />
      </div>

      <div className={s.shortcuts}>
        {activePreset ? <Badge tone="accent">Preset: {activePreset.title}</Badge> : null}
        <span>
          <kbd>1</kbd>–<kbd>3</kbd> presets
        </span>
        <span>
          <kbd>0</kbd> reset
        </span>
      </div>
    </Card>
  );
});
