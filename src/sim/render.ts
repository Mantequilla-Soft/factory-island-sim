import { FACTORY, H, W, stationPos, type Compiled, type WorldState } from "./sim";
import type { ItemKind } from "./types";

// Snapie palette (pixel-art sprite colours live here, not in CSS tokens)
export const P = { ink: "#1a1c2c", paper: "#f4f4f4", butter: "#ef7d57", grass: "#38b764", cyan: "#41a6f6", sea: "#29366f", foam: "#73eff7", sand: "#ffcd75", steel: "#566c86", red: "#b13e53" };

function hashColor(s: string) {
  const c = [P.butter, P.grass, P.cyan, P.sand, P.red, P.foam];
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return c[h % c.length];
}

function item(ctx: CanvasRenderingContext2D, k: ItemKind, x: number, y: number) {
  ctx.fillStyle = k === "scroll" ? P.paper : k === "crate" ? P.sand : k === "spring" ? P.foam : k === "gauge" ? P.cyan : P.steel;
  switch (k) {
    case "gear": ctx.fillRect(x - 2, y - 2, 5, 5); ctx.fillRect(x, y - 3, 1, 7); ctx.fillRect(x - 3, y, 7, 1); ctx.fillStyle = P.ink; ctx.fillRect(x, y, 1, 1); break;
    case "bolt": ctx.fillRect(x - 2, y - 2, 5, 2); ctx.fillRect(x, y, 1, 3); break;
    case "spring": for (let i = 0; i < 3; i++) ctx.fillRect(x - 2 + (i % 2), y - 2 + i * 2, 4, 1); break;
    case "scroll": ctx.fillRect(x - 2, y - 2, 5, 4); ctx.fillStyle = P.butter; ctx.fillRect(x - 3, y - 2, 1, 4); break;
    case "gauge": ctx.fillRect(x - 2, y - 2, 5, 5); ctx.fillStyle = P.ink; ctx.fillRect(x, y - 1, 1, 2); break;
    case "crate": ctx.fillRect(x - 2, y - 2, 5, 5); ctx.fillStyle = P.butter; ctx.fillRect(x - 2, y, 5, 1); break;
    default: ctx.fillRect(x - 2, y - 2, 5, 5); ctx.fillStyle = P.ink; ctx.fillRect(x - 1, y - 1, 3, 3); ctx.fillStyle = P.steel; ctx.fillRect(x, y, 1, 1);
  }
}

export function draw(ctx: CanvasRenderingContext2D, c: Compiled, w: WorldState, selected: string | null) {
  const t = w.t;
  ctx.fillStyle = P.sea; ctx.fillRect(0, 0, W, H);
  // waves (deterministic from t)
  ctx.fillStyle = "#3b5dc9";
  for (let i = 0; i < 40; i++) {
    const x = ((i * 53 + Math.floor(t * 6)) % (W + 10)) - 5, y = (i * 37) % H;
    ctx.fillRect(x, y, 3, 1);
  }
  // causeways
  ctx.strokeStyle = P.steel; ctx.lineWidth = 2;
  for (const I of c.islands) { ctx.beginPath(); ctx.moveTo(FACTORY.x, FACTORY.y); ctx.lineTo(I.dock.x, I.dock.y); ctx.stroke(); }
  // islands
  c.islands.forEach((I, idx) => {
    const st = w.islands[idx];
    const r = Math.min(26, I.r + Math.floor(Math.sqrt(st.buildings)));
    ctx.fillStyle = P.sand; ctx.beginPath(); ctx.ellipse(I.center.x, I.center.y, r + 2, (r + 2) * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = P.grass; ctx.beginPath(); ctx.ellipse(I.center.x, I.center.y - 1, r, r * 0.58, 0, 0, Math.PI * 2); ctx.fill();
    const n = Math.min(14, Math.floor(st.buildings / 3));
    for (let b = 0; b < n; b++) {
      const a = b * 2.39996, d = Math.sqrt(b / 14) * (r - 5);
      const bx = Math.round(I.center.x + Math.cos(a) * d), by = Math.round(I.center.y + Math.sin(a) * d * 0.55);
      const hgt = 3 + ((b * 7) % 4);
      ctx.fillStyle = b % 3 === 0 ? P.butter : b % 3 === 1 ? P.paper : P.cyan;
      ctx.fillRect(bx - 2, by - hgt, 5, hgt); ctx.fillStyle = P.ink; ctx.fillRect(bx - 2, by - hgt - 1, 5, 1);
    }
    ctx.fillStyle = P.steel; ctx.fillRect(Math.round(I.dock.x) - 3, Math.round(I.dock.y) - 2, 7, 4);
    if (selected === I.id) { ctx.strokeStyle = P.foam; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(I.center.x, I.center.y, r + 5, (r + 5) * 0.62, 0, 0, Math.PI * 2); ctx.stroke(); }
  });
  // factory
  ctx.fillStyle = P.ink; ctx.fillRect(FACTORY.x - 36, FACTORY.y - 24, 72, 48);
  ctx.fillStyle = P.steel; ctx.fillRect(FACTORY.x - 34, FACTORY.y - 22, 68, 44);
  ctx.fillStyle = P.butter; ctx.fillRect(FACTORY.x - 34, FACTORY.y - 30, 68, 8);
  ctx.fillStyle = P.ink; ctx.fillRect(FACTORY.x + 20, FACTORY.y - 40, 6, 10);
  const puff = Math.floor(t * 3) % 3;
  ctx.fillStyle = P.paper; ctx.fillRect(FACTORY.x + 21 + puff, FACTORY.y - 45 - puff * 2, 3, 3);
  for (let i = 0; i < 8; i++) { const s = stationPos(i); ctx.fillStyle = P.ink; ctx.fillRect(Math.round(s.x) - 3, Math.round(s.y) + 2, 7, 3); }
  // scraps
  for (const s of w.scraps) { ctx.fillStyle = P.foam; ctx.fillRect(s.x - 3, s.y + 4, 2, 1); ctx.fillRect(s.x + 2, s.y + 3, 2, 1); }
  // workers
  for (const wk of w.workers) {
    const { x, y } = wk.pos;
    const bob = wk.phase === "fabricating" || wk.phase === "rework" ? (Math.floor(t * 8) % 2) : 0;
    ctx.fillStyle = wk.isBot ? P.steel : P.ink; ctx.fillRect(x - 2, y - 3, 5, 6);
    ctx.fillStyle = wk.isBot ? P.cyan : hashColor(wk.actor); ctx.fillRect(x - 2, y - 7 + bob, 5, 4);
    if (wk.isBot) { ctx.fillStyle = P.butter; ctx.fillRect(x, y - 9, 1, 2); }
    if (wk.carrying) item(ctx, wk.kind, x + 5, y - 3);
    if (wk.stamped) { ctx.fillStyle = P.red; ctx.fillRect(x + 7, y - 7, 2, 2); }
  }
  // Snapie inspector bee
  for (const b of w.inspectors) {
    const f = Math.floor(t * 10) % 2;
    ctx.fillStyle = P.sand; ctx.fillRect(b.x - 2, b.y - 2, 5, 4);
    ctx.fillStyle = P.ink; ctx.fillRect(b.x, b.y - 2, 1, 4);
    ctx.fillStyle = P.foam; ctx.fillRect(b.x - 2, b.y - 4 - f, 2, 2); ctx.fillRect(b.x + 1, b.y - 4 - f, 2, 2);
  }
  if (w.hidden) { ctx.fillStyle = P.butter; ctx.fillRect(4, H - 12, 22, 9); ctx.fillStyle = P.ink; ctx.font = "7px monospace"; ctx.fillText(`+${w.hidden}`, 7, H - 5); }
}
