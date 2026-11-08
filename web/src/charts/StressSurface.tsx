import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Surface } from "../api";
import { RobustResizeObserver } from "../components/Sized";
import { reducedMotion } from "../motion";
import { usePalette, type Palette } from "../theme";

// The bank-wide stress surface, drawn with React Three Fiber.
// Floor: income kept (near-left = no shock, far-right = no income) x household bills increase (front = none, back = +50%).
// The camera sits at the no-shock corner, so the surface rises away from the viewer toward the worst case.
// Height and colour: share of all customers whose savings last under 3 months (judges' formula, from the API).
// Every number on screen comes from the server; positions between grid points are only for drawing.
//
// "Play the wave" builds the surface one income level at a time, from full income down to none, the way the
// Time machine replays month by month. Playback only scales the drawing; the readout shows the server's values.

const W = 2.4;   // x extent (income)
const D = 2.0;   // z extent (bills)
const H = 1.2;   // y extent (share)
const MS_PER_COLUMN = 190;   // about 4 seconds for the whole sweep

const pctLabel = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

function niceMax(v: number): number {
  const step = v > 0.3 ? 0.1 : 0.05;
  return Math.max(step, Math.ceil(v / step) * step);
}

interface Geo { x: (i: number) => number; z: (j: number) => number; y: (v: number) => number; yMax: number }

/** Income columns raised so far (fractional while one is rising); null means the surface is fully built. */
type Build = number | null;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** How far column i has risen, 0 to 1. */
function rise(build: Build, i: number): number {
  return build == null ? 1 : easeOut(Math.min(1, Math.max(0, build - i)));
}

function useGeo(s: Surface): Geo {
  return useMemo(() => {
    const yMax = niceMax(s.max);
    return {
      x: (i: number) => -W / 2 + (i / (s.income.length - 1)) * W,
      z: (j: number) => D / 2 - (j / (s.bills.length - 1)) * D,
      y: (v: number) => (v / yMax) * H,
      yMax,
    };
  }, [s]);
}

function rampColor(pal: Palette, t: number, out: THREE.Color): THREE.Color {
  const stops = pal.heat;
  const f = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const k = Math.floor(f);
  return out.set(stops[k]).lerp(new THREE.Color(stops[k + 1]), f - k);
}

function SurfaceMesh({ s, g, pal, build, onHover, onPick }: {
  s: Surface; g: Geo; pal: Palette; build: Build; onHover: (ij: [number, number] | null) => void; onPick: (ij: [number, number]) => void;
}) {
  const invalidate = useThree((st) => st.invalidate);
  const geometry = useMemo(() => {
    const ni = s.income.length, nj = s.bills.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ni * nj * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(ni * nj * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < ni - 1; i++) {
      for (let j = 0; j < nj - 1; j++) {
        const a = i * nj + j, b = (i + 1) * nj + j, cc = (i + 1) * nj + j + 1, d = i * nj + j + 1;
        idx.push(a, b, d, b, cc, d);
      }
    }
    geo.setIndex(idx);
    return geo;
  }, [s]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Heights and colours: each column at its current rise (all 1 when built), then redraw on demand.
  useLayoutEffect(() => {
    const ni = s.income.length, nj = s.bills.length;
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = geometry.getAttribute("color") as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < ni; i++) {
      const f = rise(build, i);
      for (let j = 0; j < nj; j++) {
        const v = s.under3[i][j] * f;
        pos.setXYZ(i * nj + j, g.x(i), g.y(v), g.z(j));
        rampColor(pal, v / g.yMax, c);
        col.setXYZ(i * nj + j, c.r, c.g, c.b);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    invalidate();
  }, [geometry, build, s, g, pal, invalidate]);

  const nearest = (p: THREE.Vector3): [number, number] => {
    const i = Math.round(((p.x + W / 2) / W) * (s.income.length - 1));
    const j = Math.round(((D / 2 - p.z) / D) * (s.bills.length - 1));
    return [Math.max(0, Math.min(s.income.length - 1, i)), Math.max(0, Math.min(s.bills.length - 1, j))];
  };

  return (
    <mesh geometry={geometry}
          onPointerMove={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); if (build == null) onHover(nearest(e.point)); }}
          onPointerOut={() => onHover(null)}
          onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.delta < 4 && build == null) onPick(nearest(e.point)); }}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.85} metalness={0}
                            polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
    </mesh>
  );
}

/** A line that follows the surface along one grid row or column (and rises with it while the wave builds). */
function SurfaceLine({ s, g, along, index, color, width, opacity = 1, build = null }: {
  s: Surface; g: Geo; along: "income" | "bills"; index: number; color: string; width: number; opacity?: number; build?: Build;
}) {
  const pts = useMemo(() => {
    if (along === "bills") {
      const f = rise(build, index);
      return s.bills.map((_, j) => [g.x(index), g.y(s.under3[index][j] * f) + 0.004, g.z(j)] as [number, number, number]);
    }
    // A line across income stops at the front of the wave while it builds.
    const upto = build == null ? s.income.length : Math.min(s.income.length, Math.ceil(build));
    return s.income.slice(0, upto).map((_, i) => [g.x(i), g.y(s.under3[i][index] * rise(build, i)) + 0.004, g.z(index)] as [number, number, number]);
  }, [s, g, along, index, build]);
  if (pts.length < 2 || (along === "bills" && build != null && build <= index)) return null;
  return <Line points={pts} color={color} lineWidth={width} transparent={opacity < 1} opacity={opacity} />;
}

function Axes({ s, g, pal }: { s: Surface; g: Geo; pal: Palette }) {
  const floor: [number, number, number][] = [[-W / 2, 0, D / 2], [W / 2, 0, D / 2], [W / 2, 0, -D / 2], [-W / 2, 0, -D / 2], [-W / 2, 0, D / 2]];
  const yTicks = [g.yMax / 2, g.yMax];   // the floor is 0%; a label there would collide with the bills axis
  const incTicks = [100, 75, 50, 25, 0];
  const billTicks = [0, 10, 20, 30, 40, 50];
  return (
    <group>
      <Line points={floor} color={pal.axis} lineWidth={1} />
      <Line points={[[-W / 2, 0, -D / 2], [-W / 2, H, -D / 2]]} color={pal.axis} lineWidth={1} />
      {yTicks.map((t) => (
        <group key={t}>
          <Line points={[[-W / 2, g.y(t), -D / 2], [W / 2, g.y(t), -D / 2]]} color={pal.grid} lineWidth={1} />
          <Html position={[-W / 2 - 0.14, g.y(t), -D / 2]} center className="surface-label" zIndexRange={[10, 0]}>{pctLabel(t)}</Html>
        </group>
      ))}
      {incTicks.map((v) => {
        const i = s.income.indexOf(v);
        return i < 0 ? null : (
          <Html key={v} position={[g.x(i), -0.02, D / 2 + 0.14]} center className="surface-label" zIndexRange={[10, 0]}>{v}%</Html>
        );
      })}
      {billTicks.map((v) => {
        const j = s.bills.indexOf(v);
        return j < 0 ? null : (
          <Html key={v} position={[-W / 2 - 0.18, -0.02, g.z(j)]} center className="surface-label" zIndexRange={[10, 0]}>+{v}%</Html>
        );
      })}
      <Html position={[0, -0.02, D / 2 + 0.34]} center className="surface-label strong" zIndexRange={[10, 0]}>Income kept</Html>
      <Html position={[-W / 2 - 0.55, -0.02, 0]} center className="surface-label strong" zIndexRange={[10, 0]}>Bills up</Html>
      <Html position={[-W / 2 + 0.32, H + 0.12, -D / 2]} center className="surface-label strong" zIndexRange={[10, 0]}>Under 3 months</Html>
    </group>
  );
}

/** Surface height at an arbitrary (income %, bills %) point, by bilinear interpolation: used only to place the marker. */
function heightAt(s: Surface, income: number, bills: number): number {
  const fi = Math.min(s.income.length - 1, Math.max(0, (s.income[0] - income) / (s.income[0] - s.income[1])));
  const fj = Math.min(s.bills.length - 1, Math.max(0, (bills - s.bills[0]) / (s.bills[1] - s.bills[0])));
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  const i1 = Math.min(i0 + 1, s.income.length - 1), j1 = Math.min(j0 + 1, s.bills.length - 1);
  const ti = fi - i0, tj = fj - j0;
  const v = (a: number, b: number) => s.under3[a][b];
  return (v(i0, j0) * (1 - ti) + v(i1, j0) * ti) * (1 - tj) + (v(i0, j1) * (1 - ti) + v(i1, j1) * ti) * tj;
}

function Marker({ s, g, pal, label }: { s: Surface; g: Geo; pal: Palette; label: string }) {
  const m = s.marker;
  const fi = (s.income[0] - m.income) / (s.income[0] - s.income[1]);
  const fj = (m.bills - s.bills[0]) / (s.bills[1] - s.bills[0]);
  const x = -W / 2 + (fi / (s.income.length - 1)) * W;
  const z = D / 2 - (Math.min(fj, s.bills.length - 1) / (s.bills.length - 1)) * D;
  const y = g.y(heightAt(s, m.income, Math.min(m.bills, s.bills[s.bills.length - 1])));
  return (
    <group>
      <Line points={[[x, 0, z], [x, y, z]]} color={pal.ink} lineWidth={1.5} dashed dashSize={0.03} gapSize={0.02} />
      <mesh position={[x, y, z]}>
        <sphereGeometry args={[0.045, 24, 16]} />
        <meshStandardMaterial color={pal.ink} />
      </mesh>
      <Html position={[x, y + 0.12, z]} center className="surface-tip marker" zIndexRange={[20, 10]}>{label}</Html>
    </group>
  );
}

// The camera looks at the scene from the no-shock corner. Narrow (phone) frames pull it back so the axis labels
// stay inside the canvas; wide frames bring it in so the surface fills the card.
const VIEW_DIR = new THREE.Vector3(-3.0, 2.3, 3.2).normalize();
const TARGET = new THREE.Vector3(0, 0.05, 0);

function FitCamera() {
  const { camera, size, controls, invalidate } = useThree();
  useEffect(() => {
    if (!size.width || !size.height) return;
    const aspect = size.width / size.height;
    const dist = 4.3 * Math.max(1, 1.55 / aspect) ** 0.62;
    camera.position.copy(VIEW_DIR).multiplyScalar(dist).add(TARGET);
    camera.lookAt(TARGET);
    const c = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (c?.target) { c.target.copy(TARGET); c.update?.(); }
    invalidate();
  }, [camera, size.width, size.height, controls, invalidate]);
  return null;
}

/** Play, pause and scrub the wave building up (requestAnimationFrame only while playing). */
function useBuild(columns: number, resetKey: unknown) {
  const [build, setBuild] = useState<Build>(null);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  useEffect(() => { setPlaying(false); setBuild(null); }, [resetKey]);   // a new shock shows the finished surface
  useEffect(() => {
    if (!playing) return;
    if (reducedMotion()) { setBuild(null); setPlaying(false); return; }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / MS_PER_COLUMN;
      last = now;
      setBuild((b) => {
        const next = (b ?? 0) + dt;
        if (next >= columns + 0.999) { setPlaying(false); return null; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, columns]);
  const toggle = () => {
    if (playing) { setPlaying(false); return; }
    setBuild((b) => b ?? 0);
    setPlaying(true);
  };
  const scrub = (v: number) => { setPlaying(false); setBuild(v >= columns ? null : v); };
  return { build, playing, toggle, scrub };
}

export default function StressSurface({ s, onPick, markerLabel }: {
  s: Surface; onPick: (income: number, bills: number) => void; markerLabel: string;
}) {
  const pal = usePalette();
  const g = useGeo(s);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const reduceMotion = reducedMotion();
  const ei = s.income.indexOf(55);
  const ni = s.income.length, nj = s.bills.length;
  const { build, playing, toggle, scrub } = useBuild(ni, s);
  // The column at the front of the wave: the income level whose numbers the readout shows while it builds.
  const front = build == null ? null : Math.min(ni - 1, Math.max(0, Math.ceil(build) - 1));

  return (
    <div className="surface-wrap" style={{ cursor: hover ? "pointer" : "grab" }}>
      <div className="surface-readout" aria-live={playing ? "off" : "polite"}>
        {front != null ? (
          <>
            <span className="lbl">Income kept {s.income[front]}%</span>
            <strong>{pctLabel(s.under3[front][0], 1)}</strong>
            <span>under 3 months; {pctLabel(s.under3[front][nj - 1], 1)} if bills also go up {s.bills[nj - 1]}%</span>
          </>
        ) : hover ? (
          <>
            <span className="lbl">Income {s.income[hover[0]]}%, bills +{s.bills[hover[1]]}%</span>
            <strong>{pctLabel(s.under3[hover[0]][hover[1]], 1)}</strong>
            <span>under 3 months. Click to try it.</span>
          </>
        ) : (
          <>
            <span className="lbl">This shock</span>
            <strong>{pctLabel(s.marker.under3, 1)}</strong>
            <span>under 3 months</span>
          </>
        )}
      </div>
      <div className="surface-hint" aria-hidden>Drag to turn · scroll to zoom · click to apply</div>
      <div className="surface-play">
        <button type="button" className="btn btn-primary" onClick={toggle} aria-pressed={playing}>
          {playing ? "Pause" : build == null ? "Play the wave" : "Resume"}
        </button>
        <label htmlFor="surface-build" className="sr-only">Build the surface up to an income level</label>
        <input id="surface-build" type="range" min={0} max={ni} step={1} value={build == null ? ni : Math.ceil(build)}
               aria-valuetext={front == null ? "Whole surface" : `Income kept ${s.income[front]}%`}
               onChange={(e) => scrub(Number(e.target.value))} />
        <span className="pg-month surface-play-level" aria-hidden>{front == null ? "All" : `${s.income[front]}%`}</span>
      </div>
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [-3.0, 2.3, 3.2], fov: 40 }}
              resize={{ polyfill: RobustResizeObserver as unknown as typeof ResizeObserver }}
              gl={{ antialias: true, alpha: true }} flat>
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 4, 3]} intensity={1.1} />
        <group position={[0, -0.35, 0]}>
          <SurfaceMesh s={s} g={g} pal={pal} build={build}
                       onHover={(ij) => setHover((h) => (h?.[0] === ij?.[0] && h?.[1] === ij?.[1] ? h : ij))}
                       onPick={([i, j]) => onPick(s.income[i], s.bills[j])} />
          {/* recessive mesh lines every 20% of income and 10% of bills */}
          {s.income.map((v, i) => (v % 20 === 0 ? <SurfaceLine key={`i${v}`} s={s} g={g} along="bills" index={i} color={pal.ink} width={0.6} opacity={0.18} build={build} /> : null))}
          {s.bills.map((v, j) => (v % 10 === 0 ? <SurfaceLine key={`b${v}`} s={s} g={g} along="income" index={j} color={pal.ink} width={0.6} opacity={0.18} build={build} /> : null))}
          {/* the two slices the Main finding charts: employed (blue) and on EI at 55% (tangerine) */}
          <SurfaceLine s={s} g={g} along="bills" index={0} color={pal.today} width={3} build={build} />
          {ei >= 0 && <SurfaceLine s={s} g={g} along="bills" index={ei} color={pal.shock} width={3} build={build} />}
          <Axes s={s} g={g} pal={pal} />
          {build == null
            ? <Marker s={s} g={g} pal={pal} label={markerLabel} />
            : front != null && <SurfaceLine s={s} g={g} along="bills" index={front} color={pal.ink} width={2.5} build={build} />}
          {hover && build == null && (
            <mesh position={[g.x(hover[0]), g.y(s.under3[hover[0]][hover[1]]) + 0.01, g.z(hover[1])]}>
              <sphereGeometry args={[0.035, 20, 14]} />
              <meshBasicMaterial color={pal.today} />
            </mesh>
          )}
        </group>
        <FitCamera />
        <OrbitControls makeDefault target={[TARGET.x, TARGET.y, TARGET.z]} enableDamping dampingFactor={0.12} enablePan={false}
                       minDistance={2.6} maxDistance={9} maxPolarAngle={Math.PI / 2.05}
                       autoRotate={false} rotateSpeed={reduceMotion ? 0.5 : 0.8} />
      </Canvas>
    </div>
  );
}
