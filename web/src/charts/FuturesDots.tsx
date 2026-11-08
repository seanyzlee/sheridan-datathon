import { useRef } from "react";
import type { ShockResult } from "../api";
import { ChartFrame, DataTable } from "../components/ui";
import { pct } from "../format";
import { gsap, reducedMotion, useGSAP } from "../motion";
import { usePalette } from "../theme";

// 100 futures as 100 dots: "73 of 100" reads faster than "73%". The count is the server's survival probability
// out of 100 (rounded to whole dots); the exact figure and the number of simulated paths are in the table.

export function FuturesDots({ r, stale, simple }: { r: ShockResult; stale?: boolean; simple?: boolean }) {
  const pal = usePalette();
  const ref = useRef<HTMLDivElement>(null);
  const made = Math.round(r.survival.p * 100);
  const T = r.target;

  useGSAP(() => {
    if (reducedMotion()) return;
    const dots = ref.current?.querySelectorAll(".fd-dot.on");
    if (!dots?.length) return;
    gsap.fromTo(dots, { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, stagger: { each: 0.008, from: "start" }, ease: "back.out(2)", transformOrigin: "50% 50%" });
  }, { scope: ref, dependencies: [made] });

  const table = (
    <DataTable caption="Chance of making it" rows={[r.survival]} columns={[
      { key: "p", label: `Chance of lasting ${T} months`, align: "r", render: (s) => pct(s.p, 1) },
      { key: "n", label: "Simulated futures", align: "r", render: (s) => s.n_paths.toLocaleString("en-CA") },
    ]} />
  );
  return (
    <ChartFrame title={simple ? `${made} of 100 possible futures last ${T} months` : `${made} of 100 futures make it to ${T} months`}
                sub={simple ? "Each dot is one way the next months could go" : `Each dot is 1% of ${r.survival.n_paths.toLocaleString("en-CA")} simulated futures`}
                legend={[{ label: `Lasts ${T} months`, color: pal.shock }, { label: "Runs out first", color: pal.neutral }]}
                table={table} stale={stale} label={`${made} of 100 simulated futures last ${T} months; ${100 - made} run out first`}>
      <div ref={ref} className="fd-grid" aria-hidden>
        {Array.from({ length: 100 }, (_, i) => (
          <span key={i} className={`fd-dot${i < made ? " on" : ""}`}
                style={i < made ? { background: pal.shock } : { borderColor: pal.neutral }} />
        ))}
      </div>
    </ChartFrame>
  );
}
