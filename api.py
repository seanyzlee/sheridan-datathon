"""Toonie web API (Tangerine "Resilience Rewired" challenge): the engine, plans, simulation and discovery as JSON.

    .venv/Scripts/python.exe -m uvicorn api:app --port 8000

Every number comes from the same tested modules the notebook uses (engine, plan, simulate,
discovery, tiger_client, twist). This file only shapes them for the browser. When `web/dist`
exists (after `npm run build` in web/), the built front end is served from the same port.
"""

from __future__ import annotations

import math
import random
import threading
from contextlib import asynccontextmanager
from dataclasses import asdict, astuple
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import assistant
import autopilot
import discovery
import engine
import gemini_client
import plan
import risk
import simulate
import tiger_client
import twist
from engine import Profile, Shock

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "web" / "dist"

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Preload profiles, risk factors and the no-shock bank run in the background so the first
    # click is fast, without holding up the server's start.
    threading.Thread(target=warm_up, daemon=True).start()
    yield


app = FastAPI(title="Toonie", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json",
              lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# One psycopg connection is shared; keep Tiger Data reads one at a time.
_tiger_lock = threading.Lock()


# --------------------------------------------------------------------------- JSON helpers

def clean(x):
    """Make pandas/numpy values JSON-safe: NaN and inf become None, numpy scalars become Python."""
    if isinstance(x, dict):
        return {str(k): clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if isinstance(x, np.ndarray):
        return clean(x.tolist())
    if isinstance(x, (np.bool_, bool)):
        return bool(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        x = float(x)
        return None if math.isnan(x) or math.isinf(x) else x
    if x is pd.NaT or x is None:
        return None
    if isinstance(x, pd.Timestamp):
        return x.strftime("%Y-%m-%d")
    if isinstance(x, pd.Period):
        return str(x)
    return x


def records(df: pd.DataFrame) -> list[dict]:
    return [clean(r) for r in df.to_dict(orient="records")]


# --------------------------------------------------------------------------- request models

class ShockIn(BaseModel):
    income_factor: float = Field(1.0, ge=0, le=1)
    income_months: int | None = Field(None, ge=0, le=36)
    bills_pct: float = Field(0.0, ge=0, le=5)
    spend_delta: float = Field(0.0, ge=0, le=1_000_000)
    one_off: float = Field(0.0, ge=0, le=10_000_000)
    one_off_x_S: float = Field(0.0, ge=0, le=24)
    ei_cap_on: bool = False

    def to_shock(self) -> Shock:
        return Shock(income_factor=self.income_factor, income_months=self.income_months or None,
                     bills_pct=self.bills_pct, spend_delta=self.spend_delta, one_off=self.one_off,
                     one_off_x_S=self.one_off_x_S, ei_cap_on=self.ei_cap_on)


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    text: str = Field(..., max_length=4000)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=60)
    account_id: int
    shock: ShockIn = ShockIn()
    page: str = Field("customer", max_length=40)
    view: str = Field("simple", pattern="^(simple|advanced)$")


class AutopilotIn(BaseModel):
    shock: ShockIn = ShockIn()
    steps: list[str] = Field(default_factory=list, max_length=10)


class TwistIn(BaseModel):
    text: str = Field(..., max_length=2000)


def shock_dict(s: Shock) -> dict:
    return asdict(s)


def target_for(s: Shock) -> float:
    return float(s.income_months or plan.TARGET_RUNWAY)


# --------------------------------------------------------------------------- cached heavy work

@lru_cache(maxsize=1)
def account_ids() -> list[int]:
    return [int(a) for a in engine.profiles_all()["account_id"].tolist()]


@lru_cache(maxsize=1)
def account_set() -> frozenset[int]:
    return frozenset(account_ids())


@lru_cache(maxsize=512)
def _sim_one(profile_t: tuple, shock_t: tuple, target: float) -> dict:
    return simulate.one(Profile(*profile_t), Shock(*shock_t), target=target)


@lru_cache(maxsize=64)
def _bank_run(shock_t: tuple, target: float) -> tuple[pd.DataFrame, float]:
    s = Shock(*shock_t)
    sim, secs = simulate.bank(s, target=target)
    prof = engine.profiles_all()
    rw = engine.runway_vec(prof, s)
    out = prof[["account_id", "I", "S", "B", "runway_base"]].copy()
    out["runway"] = rw["runway"].to_numpy()
    out["no_shortfall"] = rw["no_shortfall"].to_numpy()
    out["survival"] = sim["survival"].to_numpy()
    out = out.merge(plan._account_facts()[["region", "district_name"]], left_on="account_id",
                    right_index=True, how="left")
    out["income_band"] = pd.qcut(out["I"].rank(method="first"), 5, labels=INCOME_BANDS)
    return out, secs


INCOME_BANDS = ["Lowest", "Low", "Middle", "High", "Highest"]


def warm_up() -> None:
    engine.profiles_all()
    risk.risk_factors_all()
    simulate.bank_params()
    plan._account_facts()
    plan._peer_table()
    tiger_client._monthly_cache()
    account_ids()
    _bank_run(astuple(Shock()), plan.TARGET_RUNWAY)


# --------------------------------------------------------------------------- shared pieces

def runway_json(r: engine.RunwayResult) -> dict:
    return clean({"months": r.months, "no_shortfall": r.no_shortfall, "buffer_left": r.buffer_left,
                  "income": r.income, "spending": r.spending, "gap": r.gap})


def get_profile(account_id: int, live: bool) -> tuple[Profile, pd.DataFrame, str]:
    if account_id not in account_set():
        raise HTTPException(404, f"Account {account_id} is not in the data. Try 20111, or pick a random account.")
    with _tiger_lock:
        p, src = tiger_client.live_profile(account_id, prefer_live=live)
        monthly, msrc = tiger_client.live_monthly(account_id, prefer_live=live and src == tiger_client.LIVE)
    return p, monthly, src if msrc == src else tiger_client.OFFLINE


SPEND_COLUMNS = {"household_bills": "Bills", "insurance": "Insurance", "loan_payments": "Loan",
                 "card_withdrawals": "Card", "cash_withdrawals_genuine": "Cash",
                 "transfers_out_other": "Other transfers", "bank_fees": "Fees"}
FIXED = {"Bills", "Insurance", "Loan", "Fees"}


# --------------------------------------------------------------------------- endpoints: meta

@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/status")
def status() -> dict:
    with _tiger_lock:
        live = tiger_client.is_live()
    return {"source": tiger_client.LIVE if live else tiger_client.OFFLINE, "live": live,
            "backend": simulate.BACKEND, "is_cpp": simulate.IS_CPP, "accounts": len(account_ids()),
            "bank_paths": simulate.BANK_PATHS, "bank_months": simulate.BANK_MONTHS,
            "one_paths": simulate.ONE_PATHS, "ei_weekly_max": engine.EI_WEEKLY_MAX,
            "presets": {k: shock_dict(v) for k, v in engine.PRESETS.items()},
            "gemini": gemini_client.available(), "gemini_model": gemini_client.model_name()}


@app.get("/api/accounts")
def accounts() -> dict:
    return {"ids": account_ids()}


@app.get("/api/accounts/random")
def random_account() -> dict:
    return {"account_id": random.choice(account_ids())}


@app.post("/api/twist/parse")
def parse_twist(body: TwistIn, ai: bool = True) -> dict:
    """Read a twist card. The rule-based reader always runs (instant, offline). When Gemini is set up it
    reads the card too; its reading is shown when it found something, next to whether the rules agree.
    Either way the presenter checks the values before applying, and the engine does all the maths."""
    rules = twist.parse(body.text)
    rules = twist.Parsed(_within_limits(rules.shock), rules.notes)
    rules_out = {"understood": rules.understood, "notes": rules.notes, "shock": shock_dict(rules.shock),
                 "parsed": clean(rules.as_dict())}
    g = gemini_client.read_twist(body.text) if ai else None
    if g is None or not g[1]:
        return {**rules_out, "source": "rules", "rules": rules_out, "gemini": None, "agree": None}
    shock, notes = g
    gem = _parsed_dict(shock, list(notes))
    agree = _same_shock(rules.shock, shock) if rules.understood else None
    return {**gem, "source": "gemini", "rules": rules_out, "gemini": gem, "agree": agree,
            "model": gemini_client.model_name()}


def _parsed_dict(shock: Shock, notes: list[str]) -> dict:
    return {"understood": True, "notes": notes, "shock": shock_dict(shock),
            "parsed": clean(twist.Parsed(shock, notes).as_dict())}


def _within_limits(s: Shock) -> Shock:
    """Clamp a parsed shock to the ranges ShockIn (and the sliders) accept, so Apply never fails."""
    def c(x, lo, hi):
        return max(lo, min(hi, x))
    return Shock(income_factor=c(s.income_factor, 0.0, 1.0),
                 income_months=c(s.income_months, 1, 36) if s.income_months else None,
                 bills_pct=c(s.bills_pct, 0.0, 5.0), spend_delta=c(s.spend_delta, 0.0, 1_000_000.0),
                 one_off=c(s.one_off, 0.0, 10_000_000.0), one_off_x_S=c(s.one_off_x_S, 0.0, 24.0), ei_cap_on=s.ei_cap_on)


def _same_shock(a: Shock, b: Shock) -> bool:
    fa, fb = asdict(a), asdict(b)
    for k in fa:
        x, y = fa[k], fb[k]
        if isinstance(x, (int, float)) and isinstance(y, (int, float)) and not isinstance(x, bool):
            if abs(float(x) - float(y)) > 0.011 * max(1.0, abs(float(x))):
                return False
        elif x != y:
            return False
    return True


# --------------------------------------------------------------------------- endpoints: customer

@app.get("/api/customer/{account_id}")
def customer(account_id: int, live: bool = True) -> dict:
    """The customer's position today: profile, history, spending, flags and peers."""
    p, monthly, source = get_profile(account_id, live)
    f = plan.facts(account_id)
    m = monthly.sort_values("month")
    hist = m.tail(24)
    spend = m.tail(12)[list(SPEND_COLUMNS)].mean().rename(SPEND_COLUMNS)
    spend = spend[spend > 0].sort_values(ascending=False)
    return clean({
        "account_id": account_id, "source": source, "live": source == tiger_client.LIVE,
        "profile": asdict(p) | {"surplus": p.surplus},
        "facts": {"district": f["district_name"], "region": f["region"],
                  "through": pd.Timestamp(m["month"].max()).strftime("%Y-%m")},
        "runway_base": runway_json(engine.runway(p)),
        "monthly": [{"month": pd.Timestamp(r.month).strftime("%Y-%m"), "money_in": r.money_in,
                     "money_out": r.money_out, "balance": r.avg_daily_balance}
                    for r in hist.itertuples()],
        "spending": [{"category": k, "amount": v, "fixed": k in FIXED} for k, v in spend.items()],
        "flags": [{"level": fl.level, "text": fl.text} for fl in plan.risk_flags(p)],
        "peers": plan.peers(account_id),
        "goal": asdict(plan.goal_plan(p)),
    })


@app.post("/api/customer/{account_id}/shock")
def customer_shock(account_id: int, body: ShockIn, live: bool = True) -> dict:
    """What a shock does to this customer: judges' runway, survival, breaking point and plans."""
    p, _, source = get_profile(account_id, live)
    s = body.to_shock()
    target = target_for(s)
    base, shocked = engine.runway(p), engine.runway(p, s)
    sim = _sim_one(astuple(p), astuple(s), target)
    bp = engine.breaking_point(p, s, target)
    horizon = 24 if shocked.no_shortfall else int(min(24, max(6, target + 2, 2 * shocked.months + 1)))
    bd = plan.burn_down(p, s, horizon)
    fan = np.asarray(sim["fan"])[:, :horizon + 1]
    burn = []
    for i, row in enumerate(bd.itertuples()):
        burn.append({"month": int(row.month), "balance": row.balance,
                     "ei_ends": getattr(row, "balance_ei_ends", None),
                     "p10": fan[0, i] if i < fan.shape[1] else None,
                     "p50": fan[1, i] if i < fan.shape[1] else None,
                     "p90": fan[2, i] if i < fan.shape[1] else None})
    makes_it = None
    if s.income_months:
        makes_it = bool(shocked.no_shortfall or shocked.months >= s.income_months)
    return clean({
        "account_id": account_id, "source": source, "shock": shock_dict(s), "target": target,
        "runway_base": runway_json(base), "runway": runway_json(shocked), "makes_it": makes_it,
        "survival": {"p": sim["survival"], "n_paths": sim["n_paths"], "ms": sim["seconds"] * 1000,
                     "backend": sim["backend"]},
        "breaking_point": asdict(bp),
        "summary": plan.summary(p, s, sim["survival"], target),
        "waterfall": records(plan.waterfall(p, s)),
        "burn_down": burn,
        "backup": asdict(plan.backup_plan(p, s)),
        "flow": plan.money_flow(p, s),
    })


@app.post("/api/customer/{account_id}/autopilot")
def customer_autopilot(account_id: int, body: AutopilotIn, live: bool = True) -> dict:
    """Shock Autopilot: was there an income shock, the ranked recovery steps, and the result of the chosen ones."""
    p, monthly, source = get_profile(account_id, live)
    s = body.shock.to_shock()
    return clean({
        "account_id": account_id, "source": source,
        "detection": autopilot.detect(p, monthly),
        "ladder": autopilot.ladder(p, s, monthly),
        "result": autopilot.evaluate(p, s, monthly, body.steps),
    })


@app.post("/api/customer/{account_id}/note")
def customer_note(account_id: int, body: ShockIn, live: bool = True) -> dict:
    """The advisor summary in warmer, plainer words, written by Gemini from the engine's numbers only.
    A reply with any figure the engine didn't give it is rejected, and the rule-based summary is returned."""
    p, _, _ = get_profile(account_id, live)
    s = body.to_shock()
    target = target_for(s)
    sim = _sim_one(astuple(p), astuple(s), target)
    summary = plan.summary(p, s, sim["survival"], target)
    facts = gemini_client.note_facts(p, s, sim["survival"], target, plan.backup_plan(p, s), plan.goal_plan(p), summary)
    text = gemini_client.advisor_note(facts)
    if text is None:
        return {"text": summary, "source": "rules", "model": None}
    return {"text": text, "source": "gemini", "model": gemini_client.model_name()}


@app.post("/api/chat")
def chat(body: ChatIn) -> dict:
    """The assistant: answers from engine tools, and returns setting changes for the browser to apply."""
    if body.messages[-1].role != "user":
        raise HTTPException(422, "The last message must be from the user.")
    ctx = assistant.context_from(body.account_id, body.shock.to_shock(), body.page, body.view)
    return clean(assistant.chat([m.model_dump() for m in body.messages], ctx))


# --------------------------------------------------------------------------- endpoints: bank

@app.post("/api/bank")
def bank(body: ShockIn, top: int = 25) -> dict:
    s = body.to_shock()
    target = target_for(s)
    df, secs = _bank_run(astuple(s), target)
    rw = df["runway"]
    bins = np.arange(0, 37)
    clipped = rw.clip(upper=36)
    hist = [{"months": int(b), "label": "36+" if b == 36 else str(int(b)),
             "under3": int(((clipped >= b) & (clipped < b + 1) & (rw < 3)).sum()),
             "over3": int(((clipped >= b) & (clipped < b + 1) & (rw >= 3)).sum())} for b in bins]
    pv = (df.assign(under3=rw < 3)
          .pivot_table(index="region", columns="income_band", values="under3", aggfunc=["mean", "size"],
                       observed=False))
    heat = []
    for region in pv.index:
        for band in INCOME_BANDS:
            heat.append({"region": region, "band": band, "share": pv[("mean", band)].get(region),
                         "n": pv[("size", band)].get(region)})
    worst = df.sort_values(["survival", "runway"]).head(max(1, min(top, 200)))
    by_region = df.assign(under3=rw < 3).groupby("region", observed=True)["under3"].agg(["mean", "size"])
    return clean({
        "shock": shock_dict(s), "target": target, "seconds": secs, "backend": simulate.BACKEND,
        "paths": simulate.BANK_PATHS, "months": simulate.BANK_MONTHS, "customers": int(len(df)),
        "kpis": {"under3": float((rw < 3).mean()), "under3_base": float((df["runway_base"] < 3).mean()),
                 "out_of_money": float((rw == 0).mean()),
                 "expected_run_out": float(1 - df["survival"].mean()),
                 "likely_run_out": float((df["survival"] < 0.5).mean())},
        "histogram": hist, "heatmap": heat, "regions": list(pv.index), "bands": INCOME_BANDS,
        "regions_under3": [{"region": reg, "share": float(row["mean"]), "n": int(row["size"])} for reg, row in by_region.iterrows()],
        "worst": records(worst[["account_id", "region", "district_name", "I", "S", "B", "runway",
                                "no_shortfall", "survival"]]),
    })


SURFACE_INCOME = list(range(100, -1, -5))      # income kept, % of normal: the x axis runs from no shock to no income
SURFACE_BILLS = list(range(0, 51, 2))          # household bills increase, %


@lru_cache(maxsize=64)
def _surface(spend_delta: float, one_off: float, one_off_x_S: float, ei_cap_on: bool) -> tuple[list, float]:
    """Share of all customers under 3 months for every (income, bills) pair, the other levers held fixed.
    Every cell is engine.runway_vec, the judges' formula, so a slice matches the whole-bank view exactly."""
    import time
    prof = engine.profiles_all()
    t0 = time.perf_counter()
    grid = []
    for inc in SURFACE_INCOME:
        row = []
        for b in SURFACE_BILLS:
            s = Shock(income_factor=inc / 100, bills_pct=b / 100, spend_delta=spend_delta, one_off=one_off,
                      one_off_x_S=one_off_x_S, ei_cap_on=ei_cap_on)
            row.append(round(float((engine.runway_vec(prof, s)["runway"] < 3).mean()), 5))
        grid.append(row)
    return grid, time.perf_counter() - t0


@app.post("/api/bank/surface")
def bank_surface(body: ShockIn) -> dict:
    """The stress surface: income kept x bills increase -> share of the bank under 3 months of runway.
    The current shock is marked with its own exact value (it may sit between grid points)."""
    s = body.to_shock()
    grid, secs = _surface(s.spend_delta, s.one_off, s.one_off_x_S, s.ei_cap_on)
    rw = engine.runway_vec(engine.profiles_all(), s)["runway"]
    held = []
    if s.spend_delta:
        held.append(f"other costs up ${s.spend_delta:,.0f} a month")
    if s.one_off or s.one_off_x_S:
        held.append("the one-off cost")
    if s.ei_cap_on:
        held.append("the EI weekly maximum")
    return clean({
        "income": SURFACE_INCOME, "bills": SURFACE_BILLS, "under3": grid,
        "marker": {"income": round(s.income_factor * 100, 1), "bills": round(s.bills_pct * 100, 1),
                   "under3": float((rw < 3).mean())},
        "held": held, "customers": len(rw), "seconds": secs, "max": max(max(r) for r in grid),
    })


# --------------------------------------------------------------------------- endpoints: discovery

def _in_people(rate: float | None) -> dict:
    """A rate as people: "8 in 10" when it's high, "about 1 in 15" when it's low, with the icons to draw
    (`people` in the row, `filled` of them shaded)."""
    if rate is None or rate <= 0:
        return {"people": 10, "filled": 0, "in_words": "none"}
    if rate >= 0.25:
        k = max(1, round(rate * 10))
        return {"people": 10, "filled": k, "in_words": f"{k} in 10"}
    n = max(2, round(1 / rate))
    return {"people": n, "filled": 1, "in_words": f"about 1 in {n}"}


@app.get("/api/finding")
def finding() -> dict:
    e = discovery.ei_cap_effect()
    r = discovery.regional()
    return clean({
        "main": discovery.main_finding(),
        "rules": records(discovery.early_warning_summary()),
        "default_by_band": [{**d, **_in_people(d["default_rate"])} for d in records(discovery.default_by_band())],
        "fragile_groups": records(discovery.fragile_groups()),
        "tipping_point": records(discovery.tipping_point()),
        "twist_impact": records(discovery.twist_impact()),
        "ei_cap": {"hit": float(e["hit_by_cap"].mean()),
                   "crossed": float(((e["runway_judges"] >= 6) & (e["runway_capped"] < 6)).mean())},
        "regional": {"r_unemployment": float(r["share_fail"].corr(r["unemployment"])),
                     "r_salary": float(r["share_fail"].corr(r["salary"])), "districts": int(len(r)),
                     "rows": records(r)},
    })


@lru_cache(maxsize=1)
def _defaulted_list() -> list[dict]:
    ew = discovery.early_warning()
    d = ew[ew["defaulted"] == 1].sort_values("lead_months", ascending=False)
    finished = d[(d["status"] == "B") & d["lead_months"].notna()]
    typical = finished.iloc[(finished["lead_months"] - finished["lead_months"].median()).abs().argsort()].head(1)
    d = pd.concat([typical, d.drop(typical.index)])
    return [{"account_id": int(r.account_id), "lead_months": None if pd.isna(r.lead_months) else int(r.lead_months),
             "status": r.status, "known": str(r.known),
             "first_flag": None if pd.isna(r.first_flag) else str(r.first_flag)} for r in d.itertuples()]


@app.get("/api/time-machine")
def time_machine_list() -> dict:
    return {"customers": _defaulted_list()}


@app.get("/api/time-machine/{account_id}")
def time_machine(account_id: int) -> dict:
    ew = discovery.early_warning().set_index("account_id")
    if account_id not in ew.index or ew.loc[account_id, "defaulted"] != 1:
        raise HTTPException(404, f"Account {account_id} has no defaulted loan to replay.")
    row = ew.loc[account_id]
    tm = discovery.time_machine(account_id)
    loan = engine.load_table("loans").set_index("account_id").loc[account_id]
    start = pd.Timestamp(loan["loan_start"]).to_period("M")
    return clean({
        "account_id": account_id, "loan_start": str(start), "known": str(row["known"]),
        "status": row["status"], "lead_months": row["lead_months"],
        "first_flag": None if pd.isna(row["first_flag"]) else str(row["first_flag"]),
        "months": [{"month": pd.Timestamp(r.month).strftime("%Y-%m"), "runway": r.runway_base_lt3,
                    "runway_ei": r.runway_stress_ei_lt2, "buffer": r.B} for r in tm.itertuples()],
    })


@app.get("/api/method")
def method() -> dict:
    bench = ROOT / "docs" / "bench.csv"
    b = pd.read_csv(bench) if bench.exists() else pd.DataFrame()
    return clean({"backend": simulate.BACKEND, "bench": records(b), "backtest": records(discovery.backtest()),
                  "ei_weekly_max": engine.EI_WEEKLY_MAX, "cpi": risk.CPI_ANNUAL,
                  "noise_scale": risk.NOISE_SCALE, "repair_rate": risk.REPAIR_RATE})


@app.exception_handler(KeyError)
def _key_error(_, exc: KeyError):
    return JSONResponse({"detail": f"Not found: {exc}"}, status_code=404)


# --------------------------------------------------------------------------- the built front end

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Unknown API route")
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST in f.parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
