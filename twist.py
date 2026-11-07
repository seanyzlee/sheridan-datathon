"""Twist card reader (D7): turn a judge's twist text into slider values with plain rules.

    parse("Lost job, on EI at 55% for 6 months, and bills up 15%")
    -> Parsed(shock=Shock(income_factor=0.55, income_months=6, bills_pct=0.15), notes=[...])

The reader never calculates anything; it only fills in the shock, and the app always shows
what it understood before applying it, so a misread is caught on screen.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace

from engine import Shock

_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
          "ten": 10, "eleven": 11, "twelve": 12, "a": 1, "an": 1, "half": 0.5, "a half": 0.5, "double": 2,
          "twice": 2}
_NUM = r"(\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a half|half|an|a|double|twice)"
_MONEY = r"\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|K|thousand)?"


def _num(s: str) -> float:
    s = s.strip().lower()
    if s in _WORDS:
        return float(_WORDS[s])
    return float(s.replace(",", ""))


def _money(amount: str, suffix: str | None) -> float:
    v = float(amount.replace(",", ""))
    return v * 1000 if suffix else v


@dataclass
class Parsed:
    shock: Shock
    notes: list[str] = field(default_factory=list)

    @property
    def understood(self) -> bool:
        return bool(self.notes)

    def as_dict(self) -> dict:
        s = self.shock
        d = {"income_factor": s.income_factor, "income_months": s.income_months, "bills_pct": s.bills_pct,
             "spend_delta": s.spend_delta, "one_off": s.one_off, "one_off_x_S": s.one_off_x_S,
             "ei_cap_on": s.ei_cap_on}
        return {k: v for k, v in d.items() if v not in (None, 0, 0.0, False) or k == "income_factor"}


def parse(text: str) -> Parsed:
    t = " " + text.lower().replace("’", "'").replace("–", "-") + " "
    s, notes = Shock(), []

    # ---- income: EI / pay cut / job loss
    m = re.search(r"(?:ei|employment insurance)[^.;%\d]{0,25}?(\d+(?:\.\d+)?)\s*%", t) or \
        re.search(r"(\d+(?:\.\d+)?)\s*%\s*(?:of (?:their |his |her |the )?(?:income|salary|pay|wages?))?[^.;]{0,15}(?:ei|employment insurance)", t)
    if m:
        s = replace(s, income_factor=float(m.group(1)) / 100)
        notes.append(f"Income falls to {float(m.group(1)):g}% (EI)")
    elif re.search(r"\b(ei|employment insurance|laid off|lay-?off|lost (?:their |his |her |the )?job|job loss|unemploy)", t):
        s = replace(s, income_factor=0.55)
        notes.append("Job loss: income falls to the judges' EI rate of 55%")
    m = re.search(r"(?:income|pay|salary|wages?|hours)[^.;%]{0,25}?(?:cut|drop|fall|fell|reduc|down|lose|lost)\w*[^.;%\d]{0,15}(\d+(?:\.\d+)?)\s*%", t) or \
        re.search(r"(\d+(?:\.\d+)?)\s*%\s*(?:pay|income|salary|wage|hours?)\s*(?:cut|drop|reduction|loss)", t)
    if m and not re.search(r"ei|employment insurance", t[max(0, m.start() - 20):m.end()]):
        s = replace(s, income_factor=round(1 - float(m.group(1)) / 100, 4))
        notes.append(f"Income cut by {float(m.group(1)):g}%: income factor {s.income_factor:g}")
    if re.search(r"no income|income (?:stops|goes to zero|of zero)|zero income", t):
        s = replace(s, income_factor=0.0)
        notes.append("Income stops completely")

    # ---- how long (EI length)
    m = re.search(r"for\s+" + _NUM + r"\s+months?", t) or re.search(_NUM + r"[- ]months?\s+(?:on ei|of ei|ei)", t)
    if m:
        s = replace(s, income_months=int(round(_num(m.group(1)))))
        notes.append(f"Lasting {s.income_months} months")
    else:
        m = re.search(r"for\s+" + _NUM + r"\s+(?:weeks?)", t)
        if m:
            s = replace(s, income_months=max(1, int(round(_num(m.group(1)) * 12 / 52))))
            notes.append(f"Lasting {_num(m.group(1)):g} weeks (about {s.income_months} months)")
        elif re.search(r"for (?:a|one) year|12 months", t):
            s = replace(s, income_months=12)
            notes.append("Lasting 12 months")

    # ---- bills / household costs up x%
    m = re.search(r"(?:bills?|utilit\w+|household costs?|hydro|heating|insurance)[^.;%]{0,30}?(?:up|rise|rises|risen|increase\w*|jump\w*|go(?:es)? up|climb\w*|grow\w*)[^.;%\d]{0,12}(\d+(?:\.\d+)?)\s*%", t) or \
        re.search(r"(\d+(?:\.\d+)?)\s*%\s*(?:rise|increase|jump|hike)\s*(?:in|on|to)\s*(?:the\s+)?(?:household\s+)?(?:bills?|utilit)", t)
    if m:
        s = replace(s, bills_pct=float(m.group(1)) / 100)
        notes.append(f"Household bills up {float(m.group(1)):g}%")

    # ---- rent / other monthly increase in dollars
    m = re.search(r"(?:rent|mortgage|childcare|daycare|car payment|monthly costs?|spending)[^.;$\d]{0,25}?(?:up|rise|rises|increase\w*|goes up|jump\w*|by|of|\+)\s*" + _MONEY
                  + r"(?:\s*(?:a|per|/)\s*month|\s*monthly)?", t)
    if m:
        s = replace(s, spend_delta=_money(m.group(1), m.group(2)))
        notes.append(f"Monthly spending up ${s.spend_delta:,.0f}")

    # ---- one-off costs
    m = re.search(r"(?:" + _NUM + r"|full|whole|entire)\s+months?(?:'s|s')?\s+(?:of\s+)?(?:worth of\s+)?(?:spending|expenses|costs)", t)
    if m:
        k = 1.0 if m.group(1) is None else _num(m.group(1))
        s = replace(s, one_off_x_S=k)
        notes.append(f"One-off cost of {k:g} x a month's spending")
    m = re.search(r"(?:one-?off|unexpected|surprise|emergency|repair|bill of|cost of|car|roof|furnace|dental|vet|medical|fine|expense)[^.;$\d]{0,30}?" + _MONEY, t)
    if not (m and not re.search(r"%|month", t[m.end():m.end() + 3])):
        # amount first: "a $3,500 car repair"
        m = re.search(_MONEY + r"\s+(?:[a-z]+\s+){0,2}(?:repair|bill|expense|cost|fine|emergency|purchase)", t)
        if m and "$" not in t[m.start():m.start() + 1] and not re.search(r"\$", t[max(0, m.start() - 1):m.end()]):
            m = None
    if m and not re.search(r"%|month", t[m.end():m.end() + 3]):
        s = replace(s, one_off=_money(m.group(1), m.group(2)))
        notes.append(f"One-off cost of ${s.one_off:,.0f}")

    if re.search(r"\b(?:ei )?(?:weekly )?(?:max(?:imum)?|cap)\b", t) and s.income_factor < 1:
        s = replace(s, ei_cap_on=True)
        notes.append("EI weekly maximum applied ($729/week)")
    return Parsed(s, notes)
