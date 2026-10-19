import { useEffect, useRef, useState, type RefObject } from "react";
import { draw, present, clampCam, viewToBase, CAM_HOME, FX_LIFE, RW, RH, type Cam, type Fx } from "@/sim/render";
import type { Compiled, WorldState } from "@/sim/sim";

type Scene = { compiled: Compiled | null; world: WorldState | null; selected: string | null; selWorker: string | null; selIssue: string | null };
type Opts = {
  /** "always": wheel zooms the map (embed). "modifier": only Ctrl/⌘+wheel or trackpad pinch, so the page still scrolls. */
  wheel?: "always" | "modifier";
};

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
export const ZOOM_STEP = 1.5;
const clampZ = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Keep the scene point under view px (ax, ay) fixed while changing zoom to z. */
export function zoomAround(c: Cam, z: number, ax = RW / 2, ay = RH / 2): Cam {
  const nz = clampZ(z);
  const b = viewToBase(c, ax, ay);
  return clampCam({ z: nz, x: b.x - (ax - RW / 2) / nz, y: b.y - (ay - RH / 2) / nz });
}

/** client (mouse) coords -> canvas px, honouring object-fit: contain letterboxing */
export function clientToCanvas(el: HTMLCanvasElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  const s = Math.min(r.width / RW, r.height / RH) || 1;
  return { x: (clientX - r.left - (r.width - RW * s) / 2) / s, y: (clientY - r.top - (r.height - RH * s) / 2) / s, s };
}

/**
 * Draws the world full-size offscreen, then shows it through a camera (zoom + pan).
 * Ripples, honks and the camera are UI toys on wall-clock time; the simulation itself stays pure.
 */
export function useWorldCanvas(canvasRef: RefObject<HTMLCanvasElement | null>, scene: Scene, opts: Opts = {}) {
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const cam = useRef<Cam>(CAM_HOME);
  const camTarget = useRef<Cam>(CAM_HOME);
  const fx = useRef<Fx[]>([]);
  const raf = useRef(0);
  const [zoom, setZoom] = useState(1);
  const latest = useRef(scene);
  latest.current = scene;
  const wheelMode = useRef(opts.wheel ?? "always");
  wheelMode.current = opts.wheel ?? "always";
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const paint = () => {
    const ctx = canvasRef.current?.getContext("2d");
    const l = latest.current;
    if (!ctx || !l.compiled || !l.world) return;
    if (!sceneRef.current) { sceneRef.current = document.createElement("canvas"); sceneRef.current.width = RW; sceneRef.current.height = RH; }
    const sctx = sceneRef.current.getContext("2d");
    if (!sctx) return;
    sctx.imageSmoothingEnabled = false;
    const now = performance.now();
    fx.current = fx.current.filter((f) => now - f.born < FX_LIFE);
    draw(sctx, l.compiled, l.world, l.selected, l.selWorker, l.selIssue, { fx: fx.current, now });
    present(ctx, sceneRef.current, cam.current);
  };
  const kick = () => {
    if (raf.current) return;
    const loop = () => {
      const c = cam.current, g = camTarget.current, k = 0.2;
      const next = { x: c.x + (g.x - c.x) * k, y: c.y + (g.y - c.y) * k, z: c.z + (g.z - c.z) * k };
      const settled = Math.abs(next.x - g.x) < 0.2 && Math.abs(next.y - g.y) < 0.2 && Math.abs(next.z - g.z) < 0.005;
      cam.current = settled ? g : clampCam(next);
      paint();
      raf.current = !settled || fx.current.length ? requestAnimationFrame(loop) : 0;
    };
    raf.current = requestAnimationFrame(loop);
  };
  const zoomTo = (c: Cam) => { camTarget.current = clampCam({ ...c, z: clampZ(c.z) }); setZoom(camTarget.current.z); kick(); };
  const zoomOut = () => zoomTo(CAM_HOME);
  /** step zoom around a view point (defaults to the view centre) */
  const zoomBy = (factor: number, ax?: number, ay?: number) => zoomTo(zoomAround(camTarget.current, camTarget.current.z * factor, ax, ay));
  const zoomIn = () => zoomBy(ZOOM_STEP);
  const zoomOutStep = () => zoomBy(1 / ZOOM_STEP);
  const addFx = (f: Fx) => { fx.current.push(f); kick(); };
  /** canvas-pixel coords (0..RW, 0..RH) -> scene coords under the camera */
  const toBase = (x: number, y: number) => viewToBase(cam.current, x, y);
  /** call first in onClick: true when the click was really the end of a pan drag */
  const consumeDrag = () => { const d = justDragged.current; justDragged.current = false; return d; };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { paint(); }); // repaint after every render (cheap; keeps selection + world in sync)

  // keyboard: Esc resets, +/- step zoom (ignored while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") zoomOut();
      else if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-" || e.key === "_") zoomOutStep();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // wheel / trackpad pinch zoom around the cursor, drag to pan (native listeners: wheel must be non-passive)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (wheelMode.current === "modifier" && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const p = clientToCanvas(el, e.clientX, e.clientY);
      const c = zoomAround(camTarget.current, camTarget.current.z * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
      // wheel follows the hand directly — no easing, so the anchor never drifts
      cam.current = c; camTarget.current = c; setZoom(c.z); kick();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || camTarget.current.z <= 1.001) return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) { d.moved = true; el.setPointerCapture(e.pointerId); el.style.cursor = "grabbing"; }
      const s = clientToCanvas(el, 0, 0).s * cam.current.z;
      const c = clampCam({ z: camTarget.current.z, x: camTarget.current.x - dx / s, y: camTarget.current.y - dy / s });
      cam.current = c; camTarget.current = c; d.x = e.clientX; d.y = e.clientY; kick();
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      if (d.moved) { justDragged.current = true; el.style.cursor = ""; if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); }
      drag.current = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [canvasRef]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cam.current = CAM_HOME; camTarget.current = CAM_HOME; setZoom(1); fx.current = []; }, [scene.compiled]);

  const zoomed = zoom > 1.001;
  return { zoom, zoomed, zoomTo, zoomOut, zoomIn, zoomOutStep, addFx, toBase, consumeDrag };
}
