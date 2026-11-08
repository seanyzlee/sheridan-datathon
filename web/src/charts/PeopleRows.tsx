import { useRef } from "react";
import type { Finding } from "../api";
import { ChartFrame, DataTable } from "../components/ui";
import { pct } from "../format";
import { gsap, reducedMotion, useGSAP } from "../motion";
import { usePalette } from "../theme";

// Default rate by today's runway band as people: "8 in 10" or "about 1 in 15". The row length, how many are
// shaded and the words are the server's (api._in_people from discovery.default_by_band).

function Person({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <svg viewBox="0 0 16 22" className="pr-person" aria-hidden>
      <circle cx="8" cy="5" r="4" fill={fill} stroke={stroke} strokeWidth="1.2" />
      <path d="M1.5 21v-5.5a6.5 6.5 0 0 1 13 0V21z" fill={fill} stroke={stroke} strokeWidth="1.2" />
    </svg>
  );
}

const BAND_WORDS: Record<string, string> = {
  "Under 3": "Under 3 months",
  "3-6": "3 to 6 months",
  "6-12": "6 to 12 months",
  "12-120": "1 to 10 years",
};

export function PeopleRows({ bands }: { bands: Finding["default_by_band"] }) {
  const pal = usePalette();
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (reducedMotion()) return;
    ref.current?.querySelectorAll(".pr-row").forEach((row, i) => {
      gsap.fromTo(row.querySelectorAll(".pr-person-wrap.on"), { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, delay: 0.15 + i * 0.12, stagger: 0.04, ease: "back.out(2)" });
    });
  }, { scope: ref, dependencies: [bands.length] });

  const table = (
    <DataTable caption="Loans that defaulted, by how long savings would last" rows={bands} columns={[
      { key: "b", label: "Savings would last", render: (d) => BAND_WORDS[d.band] ?? "Income covers spending" },
      { key: "w", label: "Defaulted", align: "r", render: (d) => d.in_words },
      { key: "r", label: "Rate", align: "r", render: (d) => pct(d.default_rate) },
      { key: "n", label: "Loans", align: "r", render: (d) => `${d.defaults} of ${d.loans}` },
    ]} />
  );
  return (
    <ChartFrame title="Thinner savings, more defaults" sub="Out of people with a loan, how many later defaulted, by how long their savings would last today"
                legend={[{ label: "Defaulted", color: pal.critical }, { label: "Kept paying", color: pal.neutral }]} table={table}
                label={`Defaults by savings: ${bands.map((d) => `${BAND_WORDS[d.band] ?? "income covers spending"}, ${d.in_words}`).join("; ")}`}>
      <div ref={ref} className="pr">
        {bands.map((d) => (
          <div key={d.band} className="pr-row">
            <span className="pr-label">{BAND_WORDS[d.band] ?? "Income covers spending"}</span>
            <span className="pr-people">
              {Array.from({ length: d.people }, (_, i) => (
                <span key={i} className={i < d.filled ? "pr-person-wrap on" : "pr-person-wrap"}>
                  <Person fill={i < d.filled ? pal.critical : "transparent"} stroke={i < d.filled ? pal.critical : pal.neutral} />
                </span>
              ))}
            </span>
            <strong className="pr-words">{d.in_words}</strong>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}
