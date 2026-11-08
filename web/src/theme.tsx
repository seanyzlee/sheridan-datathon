import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Chart colours, validated with the dataviz skill's validator (blue, tangerine, aqua pass
// all-pairs CVD and normal-vision checks in both modes; aqua is under 3:1 on light, so every
// chart ships a table view). Grey is the de-emphasis neutral, never an identity colour.
// SVG presentation attributes can't read CSS variables, so the resolved hex values live here.
const LIGHT = {
  today: "#2a78d6",      // blue: the customer today / the base case
  shock: "#ee6a1f",      // tangerine: after the shock / simulated futures
  third: "#1baf7a",      // aqua: a third identity (money out)
  neutral: "#9aa1a9",
  ink: "#14202e",
  ink2: "#4a5562",
  muted: "#5d6671",      // axis tick text: 4.5:1 on the surface
  grid: "#e3e6e1",
  axis: "#c5cac4",
  surface: "#fdfdfc",
  critical: "#d03b3b",
  good: "#0ca30c",
  goodText: "#006300",
  shockWash: "rgba(238,106,31,0.16)",
  heat: ["#fdf0e6", "#fbd3b4", "#f6a46d", "#ee6a1f", "#b8470b"],
};

const DARK: typeof LIGHT = {
  today: "#3987e5",
  shock: "#e2621c",
  third: "#199e70",
  neutral: "#6b7480",
  ink: "#eceff2",
  ink2: "#c0c7cf",
  muted: "#8a939d",
  grid: "#26303b",
  axis: "#3a4552",
  surface: "#161e27",
  critical: "#e66767",
  good: "#0ca30c",
  goodText: "#3cc43c",
  shockWash: "rgba(226,98,28,0.22)",
  heat: ["#2a2420", "#5a3418", "#8f4719", "#d0601e", "#f59a5e"],
};

export type Palette = typeof LIGHT;
type Mode = "light" | "dark" | "system";

interface ThemeCtx { palette: Palette; mode: Mode; resolved: "light" | "dark"; setMode: (m: Mode) => void }
const Ctx = createContext<ThemeCtx | null>(null);

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function readStored(): Mode {
  try {
    const v = localStorage.getItem("rr-theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(readStored);
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const fn = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const resolved = mode === "system" ? (sysDark ? "dark" : "light") : mode;

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
  }, [mode]);

  const value = useMemo<ThemeCtx>(() => ({
    palette: resolved === "dark" ? DARK : LIGHT,
    mode,
    resolved,
    setMode: (m: Mode) => {
      setModeState(m);
      try { if (m === "system") localStorage.removeItem("rr-theme"); else localStorage.setItem("rr-theme", m); } catch { /* private window */ }
    },
  }), [mode, resolved]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}

export const usePalette = () => useTheme().palette;
