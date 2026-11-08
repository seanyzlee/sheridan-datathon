import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type ChatAction, type Shock } from "../api";
import { useAppState, type View } from "../state";
import { useTheme } from "../theme";

// The in-app assistant. It answers from the engine (the server's tools run the same code as every
// panel) and can change what's on screen. Changes apply at once and each one can be undone.

interface Snapshot { accountId: number; shock: Shock; view: View; theme: "light" | "dark" | "system"; path: string; useLive: boolean; follow: boolean }
interface Msg { role: "user" | "assistant"; text: string; actions?: ChatAction[]; unchecked?: string[]; undo?: Snapshot; undone?: boolean; error?: boolean }

const PAGE_OF: Record<string, string> = { "/": "customer", "/bank": "bank", "/finding": "finding", "/time-machine": "time_machine", "/method": "method" };

function suggestions(page: string, hasShock: boolean): string[] {
  if (page === "bank") return ["Which customers are most at risk?", "How would the bank cope with a 20% rise in bills?", "What if everyone lost 45% of income for 6 months?"];
  if (page === "finding") return ["Explain the main finding simply", "How early does the warning fire?", "Show me a customer who defaulted"];
  return hasShock
    ? ["Explain this result simply", "What would help them most?", "What's their breaking point?", "Show me the whole bank under this"]
    : ["How is this customer doing?", "What if they lost their job for 6 months?", "Could they handle a $3,000 car repair?", "Switch to the advanced view"];
}

function describeAction(a: ChatAction): string {
  switch (a.type) {
    case "open_account": return `Opened account ${a.account_id}`;
    case "set_shock": return "Changed the shock on screen";
    case "set_view": return `Switched to the ${a.view} view`;
    case "set_theme": return `Theme: ${a.theme}`;
    case "navigate": return "Opened a page";
    case "set_data_source": return "Changed the data source";
  }
}

/** Plain-text rendering with paragraphs, "- " lists and **bold**; no HTML from the model ever reaches the DOM. */
function Rich({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>);
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>)}</ul>;
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
      })}
    </>
  );
}

export function Assistant() {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, staleTime: 30_000 });
  const app = useAppState();
  const theme = useTheme();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  // ?ask=1 opens the panel; ?ask=<question> opens it and asks that question (handy for demo links).
  const askParam = useRef(new URLSearchParams(window.location.search).get("ask"));
  const [open, setOpen] = useState(!!askParam.current);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const page = PAGE_OF[pathname] ?? "customer";

  const snapshot = (): Snapshot => ({ accountId: app.accountId, shock: app.shock, view: app.view, theme: theme.mode, path: pathname, useLive: app.useLive, follow: app.follow });

  const apply = (actions: ChatAction[]) => {
    for (const a of actions) {
      if (a.type === "open_account") app.setAccountId(a.account_id);
      if (a.type === "set_shock") app.setShock(a.shock);
      if (a.type === "set_view") app.setView(a.view);
      if (a.type === "set_theme") theme.setMode(a.theme);
      if (a.type === "set_data_source") { if (a.use_live != null) app.setUseLive(a.use_live); if (a.follow != null) app.setFollow(a.follow); }
      if (a.type === "navigate") navigate({ pathname: a.path, search });
    }
  };

  const restore = (s: Snapshot) => {
    app.setAccountId(s.accountId); app.setShock(s.shock); app.setView(s.view); theme.setMode(s.theme);
    app.setUseLive(s.useLive); app.setFollow(s.follow);
    if (s.path !== pathname) navigate({ pathname: s.path, search });
  };

  const send = useMutation({
    mutationFn: (history: Msg[]) => api.chat({
      messages: history.map((m) => ({ role: m.role, text: m.text })),
      account_id: app.accountId, shock: app.shock, page, view: app.view,
    }),
    onSuccess: (r) => {
      const before = r.actions.length ? snapshot() : undefined;
      apply(r.actions);
      setMsgs((m) => [...m, { role: "assistant", text: r.reply, actions: r.actions, unchecked: r.unchecked, undo: before, error: !r.ok }]);
    },
    onError: (e: Error) => setMsgs((m) => [...m, { role: "assistant", text: e.message, error: true }]),
  });

  const ask = (text: string) => {
    const t = text.trim();
    if (!t || send.isPending) return;
    const next = [...msgs, { role: "user" as const, text: t }];
    setMsgs(next);
    setDraft("");
    send.mutate(next);
  };

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, send.isPending]);
  const fabRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) fabRef.current?.focus();   // back to the button that opened it
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // On desktop the page makes room for the open panel instead of sitting under it: styles.css reads
  // <html data-chat="open">. Charts size from their container, so nudge them once the layout settles.
  const visible = open && !!status.data?.gemini;
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.dataset.chat = "open"; else delete root.dataset.chat;
    const t = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => window.clearTimeout(t);
  }, [visible]);
  useEffect(() => () => { delete document.documentElement.dataset.chat; }, []);

  useEffect(() => {
    const q = askParam.current;
    if (!q || !status.data?.gemini) return;
    askParam.current = null;
    const p = new URLSearchParams(window.location.search);
    p.delete("ask");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${p.toString()}`);
    if (q !== "1") ask(q);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data?.gemini]);

  if (!status.data?.gemini) return null;
  const hasShock = app.shock.income_factor !== 1 || !!app.shock.bills_pct || !!app.shock.spend_delta || !!app.shock.one_off || !!app.shock.one_off_x_S;

  return (
    <>
      {!open && (
        <button ref={fabRef} type="button" className="ask-fab" onClick={() => setOpen(true)} aria-label="Open the assistant">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
          Ask
        </button>
      )}
      {open && (
        <aside className="assistant-panel" role="dialog" aria-label="Assistant" aria-modal="false">
          <header className="assistant-head">
            <div>
              <h2>Assistant</h2>
              <p>Answers come from the engine. I can also change what's on screen.</p>
            </div>
            <div className="assistant-head-actions">
              {msgs.length > 0 && <button type="button" className="btn btn-quiet" onClick={() => setMsgs([])}>New chat</button>}
              <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} aria-label="Close the assistant">Close</button>
            </div>
          </header>

          <div className="assistant-list" ref={listRef} aria-live="polite">
            {msgs.length === 0 && (
              <div className="assistant-empty">
                <p>Ask about account {app.accountId}, try a what-if, or tell me what to change.</p>
                <div className="assistant-suggest">
                  {suggestions(page, hasShock).map((s) => <button key={s} type="button" onClick={() => ask(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role}${m.error ? " error" : ""}`}>
                <Rich text={m.text} />
                {m.actions && m.actions.length > 0 && (
                  <div className="bubble-actions">
                    {m.actions.map((a, j) => <span key={j} className="action-chip">✓ {describeAction(a)}</span>)}
                    {m.undo && !m.undone && (
                      <button type="button" className="btn btn-quiet undo" onClick={() => {
                        restore(m.undo!);
                        setMsgs((all) => all.map((x, k) => (k === i ? { ...x, undone: true } : x)));
                      }}>Undo</button>
                    )}
                    {m.undone && <span className="action-chip muted">Undone</span>}
                  </div>
                )}
                {m.unchecked && m.unchecked.length > 0 && (
                  <span className="bubble-warn">Couldn't check {m.unchecked.join(", ")} against the engine. Treat {m.unchecked.length > 1 ? "these" : "it"} with care.</span>
                )}
              </div>
            ))}
            {send.isPending && <div className="bubble assistant typing" role="status" aria-label="Thinking"><span /><span /><span /></div>}
          </div>

          <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
            <label htmlFor="ask-input" className="sr-only">Message the assistant</label>
            <textarea id="ask-input" name="ask" autoComplete="off" ref={inputRef} rows={1} value={draft} maxLength={2000}
                      placeholder={app.view === "simple" ? "Ask anything, or say what to change…" : "Ask, or e.g. “set bills +20% and open the whole bank”…"}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(draft); } }} />
            <button type="submit" className="btn btn-primary" disabled={!draft.trim() || send.isPending}>Send</button>
          </form>
        </aside>
      )}
    </>
  );
}
