import { Html, Line } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ShockResult } from "../api";
import { RobustResizeObserver } from "../components/Sized";
import { compactMoney, money } from "../format";
import { usePalette, type Palette } from "../theme";

// The customer's simulated futures in 3D. x: months from now; y: balance. A translucent slab spans the
// 10th-90th percentile of the simulated futures (the slab's depth is only there so the band reads as a
// solid object), a glowing tube is the median, a dark tube is the judges' straight line, and a red wall
// and floor mark $0 (below it the money has run out). Every value is from the API; this file only
// places, labels and animates them.

const WX = 6, DEPTH = 0.9;
const HY_WIDE = 3, HY_NARROW = 5.4;   // the chart is taller relative to its width on a phone
const BACK = -DEPTH / 2 - 0.02;
type Row = ShockResult["burn_down"][number];
type Scales = ReturnType<typeof useScales>;

const minus = (s: string) => s.replace("-", "−");
const axisMoney = (v: number) => (Math.abs(v) < 0.5 ? "$0" : minus(compactMoney(v)));

/** Round tick values for the money axis (axis placement only, never a reported figure). Always includes $0. */
function niceTicks(lo: number, hi: number, target = 4): number[] {
  const raw = (hi - lo) / target || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  if (lo <= 0 && hi >= 0 && !out.includes(0)) out.push(0);
  return out.sort((a, b) => a - b);
}

function useScales(rows: Row[], HY: number) {
  return useMemo(() => {
    const vals = rows.flatMap((r) => [r.balance, r.p10 ?? r.balance, r.p90 ?? r.balance, r.p50 ?? r.balance]);
    const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
    const n = Math.max(1, rows.length - 1);
    return {
      x: (i: number) => -WX / 2 + (i / n) * WX,
      y: (v: number) => -HY / 2 + ((v - lo) / (hi - lo || 1)) * HY,
      lo, hi, n, hy: HY,
    };
  }, [rows, HY]);
}

/** The 10th-90th percentile band, extruded into a slab with crisp outlines on its front face. */
function Band({ rows, sc, color, clip }: { rows: Row[]; sc: Scales; color: string; clip: THREE.Plane[] }) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    rows.forEach((r, i) => (i === 0 ? shape.moveTo(sc.x(i), sc.y(r.p90 ?? r.balance)) : shape.lineTo(sc.x(i), sc.y(r.p90 ?? r.balance))));
    for (let i = rows.length - 1; i >= 0; i--) shape.lineTo(sc.x(i), sc.y(rows[i].p10 ?? rows[i].balance));
    const g = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false });
    g.translate(0, 0, -DEPTH / 2);
    return g;
  }, [rows, sc]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} renderOrder={2}>
      <meshStandardMaterial color={color} transparent opacity={0.34} roughness={0.55} metalness={0.05}
                            side={THREE.DoubleSide} depthWrite={false} clippingPlanes={clip} />
    </mesh>
  );
}

function Tube({ rows, sc, pick, color, radius, z = 0, glow = false, opacity = 1, clip }: {
  rows: Row[]; sc: Scales; pick: (r: Row) => number; color: string; radius: number; z?: number; glow?: boolean; opacity?: number; clip: THREE.Plane[];
}) {
  const geo = useMemo(() => {
    const pts = rows.map((r, i) => new THREE.Vector3(sc.x(i), sc.y(pick(r)), z));
    if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0.01, 0, 0)));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "centripetal"), Math.max(48, rows.length * 12), radius, 12, false);
  }, [rows, sc, pick, radius, z]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} renderOrder={3}>
      <meshStandardMaterial color={color} emissive={glow ? color : "#000000"} emissiveIntensity={glow ? 0.5 : 0} roughness={0.35}
                            transparent={opacity < 1} opacity={opacity} clippingPlanes={clip} />
    </mesh>
  );
}

/** Back wall: money gridlines, month gridlines, the $0 line and a red wash under it. */
function Wall({ sc, ticks, months, pal }: { sc: Scales; ticks: number[]; months: number[]; pal: Palette }) {
  const geo = useMemo(() => {
    const p: number[] = [];
    for (const t of ticks) if (Math.abs(t) > 0.5) p.push(-WX / 2, sc.y(t), BACK, WX / 2, sc.y(t), BACK);
    for (const m of months) p.push(sc.x(m), -sc.hy / 2, BACK, sc.x(m), sc.hy / 2, BACK);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    return g;
  }, [sc, ticks, months]);
  useEffect(() => () => geo.dispose(), [geo]);
  const zeroY = sc.y(0);
  const below = zeroY + sc.hy / 2;
  return (
    <>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color={pal.axis} transparent opacity={0.9} />
      </lineSegments>
      {below > 0.01 && (
        <mesh position={[0, -sc.hy / 2 + below / 2, BACK - 0.01]}>
          <planeGeometry args={[WX, below]} />
          <meshBasicMaterial color={pal.critical} transparent opacity={0.07} depthWrite={false} />
        </mesh>
      )}
      <Line points={[[-WX / 2, zeroY, BACK], [WX / 2, zeroY, BACK]]} color={pal.critical} lineWidth={2} />
      {/* the $0 floor: below this the money has run out */}
      <mesh position={[0, zeroY, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <planeGeometry args={[WX, DEPTH + 0.04]} />
        <meshBasicMaterial color={pal.critical} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[[-WX / 2, zeroY, DEPTH / 2 + 0.02], [WX / 2, zeroY, DEPTH / 2 + 0.02]]} color={pal.critical} lineWidth={1} dashed dashSize={0.08} gapSize={0.06} transparent opacity={0.7} />
    </>
  );
}

/** Frames the chart for any aspect ratio, draws it in from the left, and drifts gently toward the cursor. */
function Rig({ clip, k, onDone, hy }: { clip: THREE.Plane; k: string; onDone: () => void; hy: number }) {
  const { camera, size, invalidate } = useThree();
  const reduce = useMemo(() => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const start = useRef(0);
  const done = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const placed = useRef(false);

  useEffect(() => { start.current = performance.now(); done.current = false; invalidate(); }, [k, invalidate]);
  useEffect(() => {
    if (reduce) return;
    const on = (e: PointerEvent) => {
      pointer.current = { x: e.clientX / window.innerWidth - 0.5, y: e.clientY / window.innerHeight - 0.5 };
      invalidate();
    };
    window.addEventListener("pointermove", on, { passive: true });
    return () => window.removeEventListener("pointermove", on);
  }, [invalidate, reduce]);

  useFrame((_, dt) => {
    // Draw-in: a clipping plane sweeps left to right over ~1.1 s (instant with reduced motion).
    const t = reduce ? 1 : Math.min(1, (performance.now() - start.current) / 1100);
    const e = 1 - Math.pow(1 - t, 3);
    clip.constant = -WX / 2 - 0.1 + e * (WX + 0.5);
    if (t >= 1 && !done.current) { done.current = true; onDone(); }

    // Fit the chart plus its labels into the view, from slightly above and to the left so the slab shows depth.
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const vf = (cam.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const tight = aspect < 1.4;
    const needW = WX + (tight ? 2.3 : 1.7), needH = hy + 1.2;
    const dist = Math.max(needW / 2 / Math.tan(hf / 2), needH / 2 / Math.tan(vf / 2)) + DEPTH / 2;
    const dir = new THREE.Vector3(-0.2 + pointer.current.x * 0.3, 0.2 - pointer.current.y * 0.18, 1).normalize();
    const goal = dir.multiplyScalar(dist);
    if (!placed.current || reduce) { cam.position.copy(goal); placed.current = true; }
    else cam.position.lerp(goal, Math.min(1, dt * 3));
    cam.lookAt(tight ? -0.45 : 0.1, 0.12, 0);
    const settling = cam.position.distanceTo(goal) > 0.003;
    if (t < 1 || settling) invalidate();
  });
  return null;
}

function Scene({ r, pal, hover, setHover, simple, narrow }: {
  r: ShockResult; pal: Palette; hover: number | null; setHover: (i: number | null) => void; simple: boolean; narrow: boolean;
}) {
  const rows = r.burn_down;
  const sc = useScales(rows, narrow ? HY_NARROW : HY_WIDE);
  const clip = useMemo(() => new THREE.Plane(new THREE.Vector3(-1, 0, 0), -WX / 2), []);
  const clips = useMemo(() => [clip], [clip]);
  const [drawn, setDrawn] = useState(false);
  const k = JSON.stringify([r.account_id, r.shock, rows.length]);
  useEffect(() => setDrawn(false), [k]);
  const { gl } = useThree();
  useEffect(() => { gl.localClippingEnabled = true; }, [gl]);

  const zeroY = sc.y(0);
  const ticks = useMemo(() => niceTicks(sc.lo, sc.hi, 4), [sc, narrow]);
  const months = useMemo(() => {
    const n = sc.n;
    let step = n <= 8 ? 1 : n <= 16 ? 2 : n <= 36 ? 6 : 12;
    if (narrow && n > 6) step *= 2;
    const out: number[] = [];
    for (let i = 0; i <= n; i += step) out.push(i);
    if (out[out.length - 1] !== n && n - out[out.length - 1] >= step / 2) out.push(n);
    return out;
  }, [sc, narrow]);
  const runsOut = !r.runway.no_shortfall && r.runway.months > 0 && r.runway.months < rows.length - 1 ? r.runway.months : null;
  const runsX = runsOut != null ? -WX / 2 + (runsOut / sc.n) * WX : 0;
  const h = hover != null ? rows[hover] : null;

  const pickHover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const i = Math.round(((e.point.x + WX / 2) / WX) * sc.n);
    setHover(Math.max(0, Math.min(rows.length - 1, i)));
  };

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 5, 6]} intensity={1.15} />
      <directionalLight position={[-4, 2, -3]} intensity={0.25} />
      <Rig clip={clip} k={k} hy={sc.hy} onDone={() => setDrawn(true)} />

      <Wall sc={sc} ticks={ticks} months={months} pal={pal} />
      <Band rows={rows} sc={sc} color={pal.shock} clip={clips} />
      <Tube rows={rows} sc={sc} pick={(x) => x.p90 ?? x.balance} color={pal.shock} radius={0.012} z={DEPTH / 2} opacity={0.85} clip={clips} />
      <Tube rows={rows} sc={sc} pick={(x) => x.p10 ?? x.balance} color={pal.shock} radius={0.012} z={DEPTH / 2} opacity={0.85} clip={clips} />
      <Tube rows={rows} sc={sc} pick={(x) => x.p50 ?? x.balance} color={pal.shock} radius={0.05} glow clip={clips} />
      <Tube rows={rows} sc={sc} pick={(x) => x.balance} color={pal.ink} radius={0.022} z={0.02} clip={clips} />

      {runsOut != null && (
        <>
          <Line points={[[runsX, -sc.hy / 2, BACK + 0.01], [runsX, sc.hy / 2 + 0.12, BACK + 0.01]]} color={pal.critical} lineWidth={1.5} dashed dashSize={0.07} gapSize={0.05} />
          {drawn && (
            <mesh position={[runsX, zeroY, 0]}>
              <sphereGeometry args={[0.085, 24, 16]} />
              <meshStandardMaterial color={pal.critical} emissive={pal.critical} emissiveIntensity={0.45} />
            </mesh>
          )}
          <Html position={[runsX, sc.hy / 2 + 0.14, BACK]} zIndexRange={[12, 0]}>
            <div className={`f3d-mark${drawn ? " in" : ""}`}><span aria-hidden>✕</span> Runs out around month {runsOut.toFixed(1)}</div>
          </Html>
        </>
      )}

      {/* hover target: the whole chart area, not just the band */}
      <mesh position={[0, 0, DEPTH / 2 + 0.03]} onPointerMove={pickHover} onPointerDown={pickHover} onPointerOut={() => setHover(null)}>
        <planeGeometry args={[WX + 0.2, sc.hy + 0.4]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {h && hover != null && (
        <>
          <Line points={[[sc.x(hover), -sc.hy / 2, 0], [sc.x(hover), sc.hy / 2, 0]]} color={pal.ink} lineWidth={1} transparent opacity={0.45} />
          <mesh position={[sc.x(hover), sc.y(h.p50 ?? h.balance), 0]}>
            <sphereGeometry args={[0.075, 20, 14]} />
            <meshStandardMaterial color={pal.surface} emissive={pal.shock} emissiveIntensity={0.25} />
          </mesh>
        </>
      )}

      {/* money axis on the back wall's left edge, month axis along the front of the floor */}
      {ticks.map((t) => (
        <Html key={`y${t}`} position={[-WX / 2 - 0.08, sc.y(t), BACK]} zIndexRange={[10, 0]}>
          <div className={`f3d-ytick${Math.abs(t) < 0.5 ? " crit" : ""}`}>{axisMoney(t)}</div>
        </Html>
      ))}
      {months.map((m) => (
        <Html key={`x${m}`} position={[sc.x(m), -sc.hy / 2, BACK]} zIndexRange={[10, 0]}>
          <div className="f3d-xtick">{m === 0 ? "Now" : rows[m].month}</div>
        </Html>
      ))}
      <Html position={[WX / 2, -sc.hy / 2, BACK]} zIndexRange={[10, 0]}>
        <div className="f3d-xtitle">months from now</div>
      </Html>
      {!simple && zeroY > -sc.hy / 2 + 0.25 && (
        <Html position={[WX / 2, -sc.hy / 2 + 0.06, BACK]} zIndexRange={[10, 0]}>
          <div className="f3d-zone">Below $0: money has run out</div>
        </Html>
      )}
    </>
  );
}

function Readout({ r, hover, simple }: { r: ShockResult; hover: number | null; simple: boolean }) {
  const rows = r.burn_down;
  const signed = (v: number) => (v < 0 ? (simple ? `short by ${money(-v)}` : minus(money(v))) : money(v));
  if (hover == null) {
    const runsOut = !r.runway.no_shortfall && r.runway.months > 0 && r.runway.months < rows.length - 1;
    return (
      <div className="f3d-readout" aria-live="off">
        <strong>Now {money(rows[0].p50 ?? rows[0].balance)}</strong>
        {runsOut
          ? <span className="crit"><span aria-hidden>✕ </span>Runs out around month {r.runway.months.toFixed(1)}</span>
          : <span>Lasts beyond month {rows[rows.length - 1].month}</span>}
        <span className="hint">Hover or tap the chart for any month</span>
      </div>
    );
  }
  const h = rows[hover];
  return (
    <div className="f3d-readout" aria-live="off">
      <strong>{hover === 0 ? "Now" : `Month ${h.month}`}</strong>
      <span><i className="sw med" aria-hidden />Most likely {signed(h.p50 ?? h.balance)}</span>
      <span><i className="sw band" aria-hidden />8 in 10: {axisMoney(h.p10 ?? h.balance)} to {axisMoney(h.p90 ?? h.balance)}</span>
      {!simple && <span><i className="sw judge" aria-hidden />Judges' formula {minus(money(h.balance))}</span>}
    </div>
  );
}

export default function Futures3D({ r, simple = false }: { r: ShockResult; simple?: boolean }) {
  const pal = usePalette();
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const set = () => setNarrow(el.clientWidth < 560);
    set();
    const ro = new RobustResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setHover(null), [r]);
  return (
    <div className="f3d" ref={wrap}>
      <div className="f3d-stage">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [-2, 2.4, 9], fov: 34 }} gl={{ antialias: true, alpha: true }}
              resize={{ polyfill: RobustResizeObserver as unknown as typeof ResizeObserver }}>
        <Scene r={r} pal={pal} hover={hover} setHover={setHover} simple={simple} narrow={narrow} />
      </Canvas>
      </div>
      <Readout r={r} hover={hover} simple={simple} />
    </div>
  );
}
