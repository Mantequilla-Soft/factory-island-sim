import { useEffect, useRef, useState, type RefObject } from "react";
import { draw, present, clampCam, viewToBase, CAM_HOME, FX_LIFE, RW, RH, type Cam, type Fx } from "@/sim/render";
import type { Compiled, WorldState } from "@/sim/sim";

type Scene = { compiled: Compiled | null; world: WorldState | null; selected: string | null; selWorker: string | null; selIssue: string | null };

/**
 * Draws the world full-size offscreen, then shows it through a camera (island spotlight zoom).
 * Ripples, honks and the camera are UI toys on wall-clock time; the simulation itself stays pure.
 */
export function useWorldCanvas(canvasRef: RefObject<HTMLCanvasElement | null>, scene: Scene) {
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const cam = useRef<Cam>(CAM_HOME);
  const camTarget = useRef<Cam>(CAM_HOME);
  const fx = useRef<Fx[]>([]);
  const raf = useRef(0);
  const [zoomed, setZoomed] = useState(false);
  const latest = useRef(scene);
  latest.current = scene;

  const paint = () => {
    const ctx = canvasRef.current?.getContext("2d");
    const l = latest.current;
    if (!ctx || !l.compiled || !l.world) return;
    if (!sceneRef.current) { sceneRef.current = document.createElement("canvas"); sceneRef.current.width = RW; sceneRef.current.height = RH; }
    const sctx = sceneRef.current.getContext("2d")!;
    sctx.imageSmoothingEnabled = false;
    const now = performance.now();
    fx.current = fx.current.filter((f) => now - f.born < FX_LIFE);
    draw(sctx, l.compiled, l.world, l.selected, l.selWorker, l.selIssue, { fx: fx.current, now });
    present(ctx, sceneRef.current, cam.current);
  };
  const kick = () => {
    if (raf.current) return;
    const loop = () => {
      const c = cam.current, g = camTarget.current, k = 0.16;
      const next = { x: c.x + (g.x - c.x) * k, y: c.y + (g.y - c.y) * k, z: c.z + (g.z - c.z) * k };
      const settled = Math.abs(next.x - g.x) < 0.2 && Math.abs(next.y - g.y) < 0.2 && Math.abs(next.z - g.z) < 0.005;
      cam.current = settled ? g : clampCam(next);
      paint();
      raf.current = !settled || fx.current.length ? requestAnimationFrame(loop) : 0;
    };
    raf.current = requestAnimationFrame(loop);
  };
  const zoomTo = (c: Cam) => { camTarget.current = c; setZoomed(c.z > 1); kick(); };
  const zoomOut = () => zoomTo(CAM_HOME);
  const addFx = (f: Fx) => { fx.current.push(f); kick(); };
  /** canvas-pixel coords (0..RW, 0..RH) -> scene coords under the camera */
  const toBase = (x: number, y: number) => viewToBase(cam.current, x, y);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { paint(); }); // repaint after every render (cheap; keeps selection + world in sync)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") zoomOut(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cam.current = CAM_HOME; camTarget.current = CAM_HOME; setZoomed(false); fx.current = []; }, [scene.compiled]);

  return { zoomed, zoomTo, zoomOut, addFx, toBase };
}
