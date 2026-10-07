import { stateAt, stationPos, type Compiled, type Pt, type WorldState } from "./sim";
import type { ItemKind } from "./types";

/* Isometric 2:1 pixel renderer. Sprite colours live here (pixel art), not in CSS tokens. */
export const RW = 480;
export const RH = 300;
const CX = 240;
const CY = 140;

export const P = {
  ink: "#1a1c2c", paper: "#f4f4f4", butter: "#ef7d57", grass: "#38b764", cyan: "#41a6f6",
  sea: "#29366f", sea2: "#3b5dc9", foam: "#73eff7", sand: "#ffcd75", steel: "#566c86",
  red: "#b13e53", lime: "#a7f070", purple: "#5d275d", slate: "#333c57", teal: "#257179",
  wood: "#a0603a", skin: "#f2c08a",
};

/* ---------- colour + geometry helpers ---------- */
const shadeCache = new Map<string, string>();
function shade(hex: string, f: number) {
  const k = hex + f;
  const hit = shadeCache.get(k);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f)));
  const out = "#" + [n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, "0")).join("");
  shadeCache.set(k, out);
  return out;
}
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const SHIRTS = [P.butter, P.grass, P.cyan, P.red, P.purple, P.lime, P.sand, P.paper];
const HAIR = [P.ink, P.wood, P.sand, P.red, P.slate];

/** sim (top-down) coords -> isometric world units (centred on the factory) */
export const toW = (p: Pt) => ({ x: p.x - 160, y: (p.y - 96) * 1.75 });
export const proj = (x: number, y: number, z = 0): [number, number] => [CX + (x - y), CY + (x + y) / 2 - z];
export function screenToWorld(sx: number, sy: number) {
  const a = sx - CX, b = (sy - CY) * 2;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

type Ctx = CanvasRenderingContext2D;
function poly(ctx: Ctx, pts: [number, number][], col: string) {
  ctx.fillStyle = col;
  let minx = Infinity, maxx = -Infinity;
  for (const p of pts) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); }
  const n = pts.length;
  for (let x = Math.floor(minx); x < Math.ceil(maxx); x++) {
    const cx = x + 0.5;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!, b = pts[(i + 1) % n]!;
      if ((a[0] <= cx && b[0] >= cx) || (b[0] <= cx && a[0] >= cx)) {
        if (a[0] === b[0]) { lo = Math.min(lo, a[1], b[1]); hi = Math.max(hi, a[1], b[1]); }
        else { const y = a[1] + ((b[1] - a[1]) * (cx - a[0])) / (b[0] - a[0]); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      }
    }
    if (lo < hi) { const y0 = Math.round(lo); ctx.fillRect(x, y0, 1, Math.max(1, Math.round(hi) - y0)); }
  }
}
function px(ctx: Ctx, x: number, y: number, col: string, w = 1, h = 1) {
  ctx.fillStyle = col;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}
/** iso box centred at (cx,cy), base z0, half sizes hw/hd, height h */
function box(ctx: Ctx, cx: number, cy: number, z0: number, hw: number, hd: number, h: number, base: string, top?: string) {
  const z1 = z0 + h;
  poly(ctx, [proj(cx - hw, cy + hd, z0), proj(cx + hw, cy + hd, z0), proj(cx + hw, cy + hd, z1), proj(cx - hw, cy + hd, z1)], base);
  poly(ctx, [proj(cx + hw, cy + hd, z0), proj(cx + hw, cy - hd, z0), proj(cx + hw, cy - hd, z1), proj(cx + hw, cy + hd, z1)], shade(base, 0.72));
  poly(ctx, [proj(cx - hw, cy - hd, z1), proj(cx + hw, cy - hd, z1), proj(cx + hw, cy + hd, z1), proj(cx - hw, cy + hd, z1)], top ?? shade(base, 1.25));
}
function disc(cx: number, cy: number, r: number, z: number, seg = 28): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; out.push(proj(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z)); }
  return out;
}

const GLYPHS: Record<string, string[]> = {
  B: ["110", "101", "110", "101", "110"], U: ["101", "101", "101", "101", "111"],
  T: ["111", "010", "010", "010", "010"], E: ["111", "100", "110", "100", "111"],
  R: ["110", "101", "110", "101", "101"],
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};
function pixText(ctx: Ctx, str: string, x: number, y: number, col: string) {
  ctx.fillStyle = col;
  [...str].forEach((ch, i) => {
    const g = GLYPHS[ch]; if (!g) return;
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (g[gy]![gx] === "1") ctx.fillRect(Math.round(x) + i * 4 + gx, Math.round(y) + gy, 1, 1);
  });
}
function badge(ctx: Ctx, label: string, x: number, y: number) {
  const w = label.length * 4 + 3;
  x = Math.round(x - w / 2); y = Math.round(y);
  px(ctx, x - 1, y - 1, P.ink, w + 2, 9);
  px(ctx, x, y, P.butter, w, 7);
  px(ctx, x, y, P.sand, w, 1);
  pixText(ctx, label, x + 2, y + 1, P.ink);
  px(ctx, x + Math.floor(w / 2), y + 7, P.ink, 1, 2);
}

/** Screen-space hit test for workers (front-most wins). */
export const QUEUE_VISIBLE = 3;
export function workerAt(w: WorldState, sx: number, sy: number): string | null {
  let best: { id: string; d: number } | null = null;
  for (const wk of w.workers) {
    if (wk.slot >= QUEUE_VISIBLE) continue;
    const p = toW(wk.pos);
    const [x, y] = proj(p.x, p.y, 0);
    if (Math.abs(sx - x) <= 6 && sy <= y + 3 && sy >= y - 22) {
      const d = p.x + p.y;
      if (!best || d > best.d) best = { id: wk.prId, d };
    }
  }
  return best?.id ?? null;
}

function itemIcon(ctx: Ctx, k: ItemKind, x: number, y: number) {
  x = Math.round(x); y = Math.round(y);
  const c = k === "scroll" ? P.paper : k === "crate" ? P.butter : k === "spring" ? P.foam : k === "gauge" ? P.cyan : k === "bolt" ? P.sand : "#94b0c2";
  px(ctx, x - 3, y - 3, P.ink, 7, 7);
  ctx.fillStyle = c;
  switch (k) {
    case "gear": ctx.fillRect(x - 2, y - 1, 5, 3); ctx.fillRect(x - 1, y - 2, 3, 5); px(ctx, x, y, P.ink); break;
    case "bolt": ctx.fillRect(x - 2, y - 2, 5, 2); ctx.fillRect(x, y, 1, 3); break;
    case "spring": ctx.fillRect(x - 2, y - 2, 4, 1); ctx.fillRect(x - 1, y, 4, 1); ctx.fillRect(x - 2, y + 2, 4, 1); break;
    case "scroll": ctx.fillRect(x - 2, y - 2, 5, 5); px(ctx, x - 1, y - 1, P.steel, 3, 1); px(ctx, x - 1, y + 1, P.steel, 3, 1); break;
    case "gauge": ctx.fillRect(x - 2, y - 2, 5, 5); px(ctx, x, y - 1, P.red, 1, 2); break;
    case "crate": ctx.fillRect(x - 2, y - 2, 5, 5); px(ctx, x - 2, y, P.sand, 5, 1); break;
    default: ctx.fillRect(x - 2, y - 2, 5, 5); px(ctx, x - 1, y - 1, P.ink, 3, 3); px(ctx, x, y, c);
  }
}

/* ---------- island geometry (shared with hit testing) ---------- */
export type IslandGeo = { id: string; x: number; y: number; dock: { x: number; y: number }; R: number };
export function islandGeo(c: Compiled, w: WorldState): IslandGeo[] {
  return c.islands.map((I, i) => {
    const b = w.islands[i]!.buildings;
    return { id: I.id, ...toW(I.center), dock: toW(I.dock), R: Math.min(30, 17 + Math.sqrt(b) * 1.4) };
  });
}

/* ---------- characters ---------- */
function drawWorker(ctx: Ctx, x: number, y: number, t: number, actor: string, isBot: boolean, dir: { x: number; y: number }, moving: boolean, working: boolean) {
  const h = hash(actor);
  const step = moving ? Math.floor(t * 10 + (h % 7)) % 2 : 0;
  const bob = moving ? step : working ? Math.floor(t * 6 + (h % 5)) % 2 : 0;
  poly(ctx, disc(x, y, 3.2, 0, 10), "rgba(26,28,44,0.45)");
  if (isBot) {
    const [wx, wy] = proj(x, y, 0);
    px(ctx, wx - 4, wy - 2, P.ink, 3, 2); px(ctx, wx + 1, wy - 2, P.ink, 3, 2);
    box(ctx, x, y, 2 + bob, 2.5, 2.5, 5, "#94b0c2");
    box(ctx, x, y, 7 + bob, 1.8, 1.8, 3, P.foam);
    const [ax, ay] = proj(x, y, 13 + bob);
    px(ctx, ax, ay, P.steel, 1, 3);
    px(ctx, ax - (Math.floor(t * 3) % 2), ay - 1, Math.floor(t * 3) % 2 ? P.red : P.lime, 2, 1);
    return;
  }
  const [lx, ly] = proj(x, y, 0);
  px(ctx, lx - 2, ly - 3 + (step ? 1 : 0), P.ink, 1, 3 - (step ? 1 : 0));
  px(ctx, lx + 1, ly - 3 + (step ? 0 : 1), P.ink, 1, 3 - (step ? 0 : 1));
  box(ctx, x, y, 3 + bob, 2, 2, 5, SHIRTS[h % SHIRTS.length]!);
  box(ctx, x, y, 8 + bob, 2.4, 2.4, 4, P.skin, HAIR[(h >> 4) % HAIR.length]!);
  // hair fringe + eyes on the face we're looking toward
  const front = dir.x + dir.y >= -0.01;
  if (front) {
    const onLeft = dir.y >= dir.x;
    const [ex, ey] = onLeft ? proj(x, y + 2.4, 10 + bob) : proj(x + 2.4, y, 10 + bob);
    const sx = onLeft ? 1 : -1;
    px(ctx, ex - 2 * sx, ey - 0.5 * sx, P.ink); px(ctx, ex + 1 * sx, ey + 1, P.ink);
  }
}

function drawBee(ctx: Ctx, sx: number, sy: number, t: number) {
  const f = Math.floor(t * 12) % 2;
  sx = Math.round(sx); sy = Math.round(sy);
  px(ctx, sx - 4, sy - 4 - f, P.foam, 3, 2 + f); px(ctx, sx + 2, sy - 4 - f, P.foam, 3, 2 + f);
  px(ctx, sx - 3, sy - 2, P.sand, 7, 5);
  px(ctx, sx - 1, sy - 2, P.ink, 1, 5); px(ctx, sx + 2, sy - 2, P.ink, 1, 5);
  px(ctx, sx - 4, sy - 1, P.steel, 2, 3); px(ctx, sx - 4, sy, P.cyan, 1, 1);
  px(ctx, sx + 4, sy + 1, P.ink, 1, 1);
}

/* ---------- main draw ---------- */
type D = { d: number; fn: () => void };

export function draw(ctx: Ctx, c: Compiled, w: WorldState, selected: string | null, selWorker: string | null = null) {
  const t = w.t;
  const geo = islandGeo(c, w);
  const prev = new Map(stateAt(c, Math.max(0, t - 0.06)).workers.map((k) => [k.prId, k.pos]));
  const items: D[] = [];
  const add = (x: number, y: number, fn: () => void) => items.push({ d: x + y, fn });

  // sea + waves
  ctx.fillStyle = P.sea; ctx.fillRect(0, 0, RW, RH);
  for (let i = 0; i < 140; i++) {
    const x = (((i * 97 + t * 7 * (1 + (i % 3))) % (RW + 20)) + RW + 20) % (RW + 20) - 10;
    const y = (i * 53 + (i % 5) * 7) % RH;
    px(ctx, x, y, i % 4 ? P.sea2 : "#4e6fd6", 3 + (i % 3), 1);
  }

  // factory platform
  box(ctx, 0, 0, -8, 47, 47, 8, P.slate, P.teal);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    if ((i + j) % 2) continue;
    const x0 = -47 + i * (94 / 12), y0 = -47 + j * (94 / 12), s = 94 / 12;
    poly(ctx, [proj(x0, y0), proj(x0 + s, y0), proj(x0 + s, y0 + s), proj(x0, y0 + s)], "#2c8486");
  }
  // hazard trim
  for (let k = -47; k < 47; k += 4) {
    poly(ctx, [proj(k, 47, 0), proj(k + 2, 47, 0), proj(k + 2, 47, -2), proj(k, 47, -2)], P.sand);
    poly(ctx, [proj(47, k, 0), proj(47, k + 2, 0), proj(47, k + 2, -2), proj(47, k, -2)], shade(P.sand, 0.75));
  }

  // islands (ground)
  geo.forEach((g) => {
    poly(ctx, disc(g.x, g.y, g.R + 3 + Math.sin(t * 2 + g.x) * 0.6, -8), shade(P.foam, 0.85));
    for (let z = -8; z < 0; z += 1) poly(ctx, disc(g.x, g.y, g.R + 1, z), z < -4 ? P.wood : "#c28553");
    poly(ctx, disc(g.x, g.y, g.R + 1, 0), P.sand);
    poly(ctx, disc(g.x, g.y - 0.5, g.R - 2, 0.5), P.grass);
    // grass tufts
    for (let k = 0; k < 10; k++) {
      const a = (hash(g.id + k) % 628) / 100, r = ((hash(g.id + "r" + k) % 100) / 100) * (g.R - 4);
      const [tx, ty] = proj(g.x + Math.cos(a) * r, g.y + Math.sin(a) * r, 1);
      px(ctx, tx, ty, P.lime);
    }
    const target = selWorker ? w.workers.find((k) => k.prId === selWorker)?.repo : null;
    if ((selected === g.id || target === g.id) && Math.floor(t * 4) % 2 === 0) {
      for (const p of disc(g.x, g.y, g.R + 6, 0, 56)) px(ctx, p[0], p[1], P.foam);
    }
  });

  // conveyor belts factory -> docks
  geo.forEach((g, gi) => {
    const len = Math.hypot(g.dock.x, g.dock.y);
    const ux = g.dock.x / len, uy = g.dock.y / len, nx = -uy * 3.5, ny = ux * 3.5;
    const s0 = 47 / Math.max(Math.abs(ux), Math.abs(uy));
    const s1 = len - 2;
    const P0 = { x: ux * s0, y: uy * s0 }, P1 = { x: ux * s1, y: uy * s1 };
    const q = (a: Pt, b: Pt, z: number, k = 1): [number, number][] => [
      proj(a.x + nx * k, a.y + ny * k, z), proj(b.x + nx * k, b.y + ny * k, z), proj(b.x - nx * k, b.y - ny * k, z), proj(a.x - nx * k, a.y - ny * k, z),
    ];
    poly(ctx, q(P0, P1, -4), P.ink);
    poly(ctx, q(P0, P1, 1), "#3a3f5e");
    // moving treads
    const phase = (t * 10) % 6;
    for (let s = s0 + phase; s < s1 - 1; s += 6) {
      const a = { x: ux * s, y: uy * s }, b = { x: ux * (s + 1.4), y: uy * (s + 1.4) };
      poly(ctx, q(a, b, 1, 0.9), P.ink);
    }
    // rails with rollers
    for (const side of [1, -1]) {
      for (let s = s0; s < s1; s += 5) {
        const [rx, ry] = proj(ux * s + nx * side * 1.15, uy * s + ny * side * 1.15, 1);
        px(ctx, rx, ry, Math.floor(s + t * 6) % 2 ? P.butter : shade(P.butter, 0.7));
      }
      // supports into the sea
      for (let s = s0 + 8; s < s1; s += 14) {
        const [sx2, sy2] = proj(ux * s + nx * side, uy * s + ny * side, -4);
        px(ctx, sx2, sy2, P.slate, 1, 5);
      }
    }
    // decorative parcels riding the belt
    for (let k = 0; k < 2; k++) {
      const f = (t * 0.05 + k * 0.5 + gi * 0.17) % 1;
      const s = s0 + (s1 - s0) * f;
      const bx = ux * s, by = uy * s;
      add(bx, by, () => {
        box(ctx, bx, by, 1, 2.6, 2.6, 3.5, P.butter);
        const [tx, ty] = proj(bx, by, 4.5);
        px(ctx, tx - 2, ty, P.sand, 5, 1);
      });
    }
    // dock pier
    const dx = g.dock.x + ux * 3, dy = g.dock.y + uy * 3;
    add(dx - 3, dy - 3, () => {
      box(ctx, dx, dy, -6, 6, 6, 7, P.wood, "#c28553");
      for (let k = -5; k <= 5; k += 2.5) {
        const [lx, ly] = proj(dx + k, dy + 6, 1);
        px(ctx, lx, ly, shade(P.wood, 0.6), 2, 1);
      }
      const [fx, fy] = proj(dx + 5, dy - 5, 1);
      px(ctx, fx, fy - 14, P.paper, 1, 14);
      px(ctx, fx + 1, fy - 14 + (Math.floor(t * 4) % 2), SHIRTS[gi % SHIRTS.length]!, 5, 3);
    });
  });

  // island buildings
  geo.forEach((g, gi) => {
    const b = w.islands[gi]!.buildings;
    const sc = Math.min(1.3, (g.R - 8) / 12);
    const plots = [[0, 0], [-11, -11], [11, -11], [-11, 11], [11, 11], [0, -13], [-13, 0], [13, 0], [0, 13]] as const;
    // keep the dock-side plot clear
    const dlen = Math.hypot(g.dock.x - g.x, g.dock.y - g.y);
    const dux = (g.dock.x - g.x) / dlen, duy = (g.dock.y - g.y) / dlen;
    plots.forEach(([ox, oy], i) => {
      const floors = Math.min(6, Math.floor((b + 8 - i) / 9));
      if (floors <= 0) return;
      const bx = g.x + ox * sc, by = g.y + oy * sc;
      if ((ox * dux + oy * duy) / (Math.hypot(ox, oy) || 1) > 0.8) return;
      const hh = hash(g.id + i);
      const col = [P.paper, P.butter, P.cyan, P.sand, P.lime, "#94b0c2"][hh % 6]!;
      add(bx, by, () => {
        let z = 0;
        for (let f = 0; f < floors; f++) {
          const half = 4.4 - (f >= 3 ? 1 : 0) - (f >= 5 ? 0.8 : 0);
          box(ctx, bx, by, z, half, half, 4, col);
          for (const wxo of [-2, 1.5]) {
            const lit = (hash(g.id + i + "w" + f + wxo) + Math.floor(t / 6)) % 3 !== 0;
            const [a1, a2] = proj(bx + wxo, by + half, z + 2.5);
            px(ctx, a1, a2, lit ? P.sand : P.ink);
            const [b1, b2] = proj(bx + half, by + wxo, z + 2.5);
            px(ctx, b1, b2, lit ? P.foam : P.ink);
          }
          z += 4;
        }
        const roofHalf = floors >= 5 ? 2.6 : floors >= 3 ? 3.4 : 4.4;
        box(ctx, bx, by, z, roofHalf * 0.7, roofHalf * 0.7, 1.5, P.red);
        if (floors >= 4) {
          const [ax, ay] = proj(bx, by, z + 1.5);
          px(ctx, ax, ay - 5, P.steel, 1, 5);
          if (Math.floor(t * 2 + i) % 2) px(ctx, ax - 1, ay - 7, P.red, 3, 2);
        }
      });
    });
    // palm-ish tree for small islands
    const tx = g.x - dux * (g.R - 6), ty = g.y - duy * (g.R - 6);
    add(tx, ty, () => {
      const [sx, sy] = proj(tx, ty, 0);
      px(ctx, sx, sy - 9, P.wood, 1, 9);
      px(ctx, sx - 3, sy - 11, P.grass, 7, 2); px(ctx, sx - 1, sy - 12, P.lime, 3, 1);
    });
  });

  // factory: brick tower with sign + chimney (back)
  add(-14, -37, () => {
    box(ctx, -14, -37, 0, 12, 9, 46, P.butter, "#ffa27a");
    // brick rows
    for (let z = 4; z < 46; z += 4) for (let x = -26 + ((z / 4) % 2) * 2; x < -2; x += 4) {
      const [bx, by] = proj(x, -28, z); px(ctx, bx, by, shade(P.butter, 0.85), 2, 1);
    }
    const word = "BUTTER";
    for (let li = 0; li < word.length; li++) {
      const gl = GLYPHS[word[li]!]!;
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
        if (gl[gy]![gx] !== "1") continue;
        const [sx, sy] = proj(-25.5 + li * 4 + gx, -28, 38 - gy * 2);
        px(ctx, sx, sy, P.sand, 1, 2);
        px(ctx, sx, sy + 2, shade(P.butter, 0.55), 1, 1);
      }
    }
    // windows on side
    for (let z = 8; z < 30; z += 8) { const [wx, wy] = proj(-2, -40, z); px(ctx, wx, wy, Math.floor(t * 2 + z) % 3 ? P.sand : P.foam, 2, 3); }
    box(ctx, -8, -42, 46, 2.5, 2.5, 12, P.slate);
    box(ctx, -8, -42, 58, 3, 3, 1.5, P.red);
    for (let k = 0; k < 4; k++) {
      const f = (t * 0.6 + k / 4) % 1;
      const [sx, sy] = proj(-8 + f * 10, -42 - f * 6, 62 + f * 22);
      const r = 2 + Math.floor(f * 4);
      px(ctx, sx - r / 2, sy - r / 2, f > 0.7 ? "#94b0c2" : P.paper, r, r);
    }
  });

  // decorative props on the factory floor
  add(38, -38, () => { // dial panel
    box(ctx, 38, -38, 0, 4, 5, 12, P.red);
    for (let k = 0; k < 3; k++) {
      const [dx, dy] = proj(42, -41 + k * 3, 8);
      px(ctx, dx, dy, Math.floor(t * 5 + k) % 2 ? P.lime : P.ink, 1, 2);
    }
    const [gx, gy] = proj(36, -33, 8); px(ctx, gx, gy, P.paper, 3, 3); px(ctx, gx + 1 + (Math.floor(t * 3) % 2), gy + 1, P.ink);
  });
  add(-38, 38, () => { // stacked crates
    box(ctx, -40, 38, 0, 3, 3, 5, P.butter); box(ctx, -34, 40, 0, 3, 3, 5, P.butter); box(ctx, -37, 39, 5, 3, 3, 5, shade(P.butter, 1.1));
  });
  add(40, 38, () => { // water cooler + server
    box(ctx, 40, 34, 0, 3, 3, 14, "#94b0c2");
    for (let k = 0; k < 4; k++) { const [sx, sy] = proj(43, 33, 3 + k * 3); px(ctx, sx, sy, Math.floor(t * 8 + k) % 3 ? P.lime : P.ink); }
    box(ctx, 40, 42, 0, 2, 2, 7, P.paper); box(ctx, 40, 42, 7, 1.8, 1.8, 4, P.cyan);
  });

  // workstations / consoles
  for (let i = 0; i < 8; i++) {
    const s = toW(stationPos(i));
    const len = Math.hypot(s.x, s.y);
    const cx = s.x - (s.x / len) * 6, cy = s.y - (s.y / len) * 6;
    add(cx, cy, () => {
      box(ctx, cx, cy, 0, 3, 3, 6, P.paper, "#94b0c2");
      box(ctx, cx, cy, 6, 2.2, 1.4, 4, P.slate);
      const [mx, my] = proj(cx + 0.5, cy + 1.4, 8);
      const on = Math.floor(t * 4 + i) % 4;
      px(ctx, mx - 2, my - 1, on === 0 ? P.foam : P.grass, 3, 2);
      const [kx, ky] = proj(cx + 3, cy, 4);
      px(ctx, kx, ky, on % 2 ? P.red : P.sand);
    });
  }

  // hero stamping / inspection machine (centre)
  const stamping = w.inspectors.length > 0;
  add(2, 2, () => {
    box(ctx, 0, 0, 0, 10, 10, 18, P.butter);
    // intake mouth + hazard stripes on the front
    poly(ctx, [proj(-5, 10, 2), proj(5, 10, 2), proj(5, 10, 10), proj(-5, 10, 10)], P.ink);
    for (let k = -5; k < 5; k += 2) poly(ctx, [proj(k, 10, 10), proj(k + 1, 10, 10), proj(k + 1, 10, 12), proj(k, 10, 12)], P.sand);
    poly(ctx, [proj(10, -5, 2), proj(10, 5, 2), proj(10, 5, 10), proj(10, -5, 10)], P.ink);
    const glow = Math.floor(t * 8) % 2 ? P.sand : P.butter;
    px(ctx, ...(proj(10, 0, 6).map((v) => v - 1) as [number, number]), glow, 2, 2);
    box(ctx, 0, 0, 18, 7, 7, 5, shade(P.butter, 0.85));
    // orb
    const [ox, oy] = proj(0, 0, 30);
    const r = 5 + (stamping ? Math.floor(t * 10) % 2 : 0);
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
      const d = Math.hypot(xx, yy);
      if (d <= r) px(ctx, ox + xx, oy + yy, d < r * 0.45 ? P.paper : d < r * 0.8 ? P.sand : "#d9a046");
    }
    px(ctx, ox - 2, oy - 3, P.paper, 2, 1);
    if (stamping) {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + t * 2;
        const L = 8 + ((k * 7 + Math.floor(t * 12)) % 6);
        for (let s = r + 2; s < r + L; s += 1.5) px(ctx, ox + Math.cos(a) * s, oy + Math.sin(a) * s * 0.8, k % 2 ? P.foam : P.cyan);
      }
    }
  });
  // idle Snapie orbiting the machine when nobody is being stamped
  if (!stamping) {
    const bx = Math.cos(t * 1.3) * 16, by = Math.sin(t * 1.3) * 16;
    add(bx, by, () => { const [sx, sy] = proj(bx, by, 26 + Math.sin(t * 5) * 2); drawBee(ctx, sx, sy, t); });
  }

  // workers
  for (const wk of w.workers) {
    if (wk.slot >= QUEUE_VISIBLE) continue;
    const p = toW(wk.pos);
    const pp = prev.get(wk.prId);
    const q = pp ? toW(pp) : p;
    const dx = p.x - q.x, dy = p.y - q.y;
    const moving = Math.hypot(dx, dy) > 0.05;
    const dir = moving ? { x: dx, y: dy } : { x: 0.3, y: 1 };
    const working = wk.phase === "fabricating" || wk.phase === "rework";
    const sel = wk.prId === selWorker;
    add(p.x, p.y, () => {
      if (sel) {
        const on = Math.floor(t * 6) % 2 ? P.foam : P.sand;
        for (const q2 of disc(p.x, p.y, 5, 0, 16)) px(ctx, q2[0], q2[1], on);
      }
      drawWorker(ctx, p.x, p.y, t, wk.actor, wk.isBot, dir, moving, working);
      const [hx, hy] = proj(p.x, p.y, 17);
      if (wk.carrying && !working) {
        itemIcon(ctx, wk.kind, hx, hy);
        if (wk.stamped) { px(ctx, hx + 2, hy - 5, P.grass, 3, 3); px(ctx, hx + 3, hy - 4, P.paper); }
      }
      if (sel) {
        const [ax, ay] = proj(p.x, p.y, 26 + (Math.floor(t * 4) % 2));
        px(ctx, ax - 2, ay, P.foam, 5, 1); px(ctx, ax - 1, ay + 1, P.foam, 3, 1); px(ctx, ax, ay + 2, P.foam, 1, 1);
      }
      if (working) {
        if (Math.floor(t * 8 + p.x) % 3 === 0) {
          const [sx, sy] = proj(p.x - Math.sign(p.x) * 3, p.y - Math.sign(p.y) * 3, 9);
          px(ctx, sx, sy, P.sand); px(ctx, sx + 2, sy - 2, P.paper);
        }
        // progress bubble with the item being built
        if (Math.floor(t * 1.5 + p.y) % 2) itemIcon(ctx, wk.kind, hx, hy);
      }
    });
  }

  // inspectors at docks
  for (const b of w.inspectors) {
    const p = toW(b);
    add(p.x, p.y, () => {
      const [sx, sy] = proj(p.x, p.y, 22 + Math.sin(t * 6) * 2);
      drawBee(ctx, sx, sy, t);
      if (Math.floor(t * 6) % 2) { px(ctx, sx - 1, sy + 6, P.red, 3, 2); }
    });
  }
  // scrap splashes
  for (const s of w.scraps) {
    const p = toW(s);
    add(p.x, p.y, () => {
      const [sx, sy] = proj(p.x, p.y, 0);
      const k = Math.floor(t * 8) % 3;
      px(ctx, sx - 4 - k, sy - 2 - k, P.foam, 2, 1); px(ctx, sx + 3 + k, sy - 3 - k, P.foam, 2, 1);
      px(ctx, sx - 1, sy - 6 - k * 2, P.paper, 2, 2);
    });
  }

  // crowd badges at piers whose queue overflows
  geo.forEach((g, gi) => {
    const extra = w.islands[gi]!.queue - QUEUE_VISIBLE;
    if (extra <= 0) return;
    add(g.dock.x + 40, g.dock.y + 40, () => {
      const [bx, by] = proj(g.dock.x, g.dock.y, 24 + (Math.floor(t * 3) % 2));
      badge(ctx, `+${extra}`, bx, by);
    });
  });

  items.sort((a, b) => a.d - b.d);
  for (const it of items) it.fn();

  if (w.hidden) badge(ctx, `+${w.hidden}`, 16, RH - 14);
}
