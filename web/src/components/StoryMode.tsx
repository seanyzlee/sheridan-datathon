import { useCallback, useEffect, useRef, useState } from "react";
import { reducedMotion } from "../motion";

// A guided walk through a page for presenting: each step scrolls to an element marked data-story="<key>",
// rings it, and shows one caption. Captions are written by the page from its own server figures.
// Steps whose element isn't on screen (for example, advanced-only charts in the simple view) are skipped.

export interface StoryStep { key: string; title: string; caption: string }

export function StoryMode({ steps, label = "Walk me through it" }: { steps: StoryStep[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [k, setK] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // Which steps have their element on the page, collected when the walk starts (after the page has rendered).
  const [live, setLive] = useState<StoryStep[]>([]);
  const step = live[Math.min(k, live.length - 1)];
  const start = () => {
    const present = steps.filter((s) => document.querySelector(`[data-story="${s.key}"]`));
    if (!present.length) return;
    setLive(present);
    setK(0);
    setOpen(true);
  };

  const close = useCallback(() => {
    setOpen(false);
    document.querySelectorAll(".story-focus").forEach((el) => el.classList.remove("story-focus"));
    opener.current?.focus();
  }, []);

  useEffect(() => {
    if (!open || !step) return;
    document.querySelectorAll(".story-focus").forEach((el) => el.classList.remove("story-focus"));
    const el = document.querySelector<HTMLElement>(`[data-story="${step.key}"]`);
    if (!el) return;
    el.classList.add("story-focus");
    el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>(".story-next")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setK((v) => Math.min(v + 1, live.length - 1));
      if (e.key === "ArrowLeft") setK((v) => Math.max(v - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, live.length]);

  useEffect(() => () => document.querySelectorAll(".story-focus").forEach((el) => el.classList.remove("story-focus")), []);

  if (!steps.length) return null;
  return (
    <>
      <button ref={opener} type="button" className="btn btn-primary story-open" onClick={start}>
        <span aria-hidden>▶</span> {label}
      </button>
      {open && step && (
        <div ref={panel} className="story-panel" role="dialog" aria-modal="false" aria-labelledby="story-title" aria-describedby="story-caption">
          <div className="story-progress" aria-hidden>
            {live.map((s, i) => <span key={s.key} className={i <= k ? "on" : ""} />)}
          </div>
          <span className="story-count">Step {k + 1} of {live.length}</span>
          <h2 id="story-title">{step.title}</h2>
          <p id="story-caption" aria-live="polite">{step.caption}</p>
          <div className="story-btns">
            <button type="button" className="btn btn-quiet" onClick={close}>Close</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={() => setK((v) => Math.max(v - 1, 0))} disabled={k === 0}>Back</button>
            {k < live.length - 1
              ? <button type="button" className="btn btn-primary story-next" onClick={() => setK((v) => v + 1)}>Next</button>
              : <button type="button" className="btn btn-primary story-next" onClick={close}>Done</button>}
          </div>
        </div>
      )}
    </>
  );
}
