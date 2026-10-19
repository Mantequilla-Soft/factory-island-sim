import { stateAt, stationPos, toWorld, islandRadius, nightAt, type Compiled, type Pt, type WorldState } from "./sim";
import type { ItemKind } from "./types";
import { orgTheme } from "./orgTheme";
import type { CreatureState } from "./sim";

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
export const toW = toWorld;
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
  A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"], C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"], E: ["111", "100", "110", "100", "111"], F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"], H: ["101", "101", "111", "101", "101"], I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"], K: ["101", "101", "110", "101", "101"], L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"], N: ["110", "101", "101", "101", "101"], O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"], Q: ["010", "101", "101", "110", "011"], R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"], T: ["111", "010", "010", "010", "010"], U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"], W: ["101", "101", "111", "111", "101"], X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"], Z: ["111", "001", "010", "100", "111"],
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"], "!": ["010", "010", "010", "000", "010"],
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
    return { id: I.id, ...toW(I.center), dock: toW(I.dock), R: islandRadius(b) };
  });
}

/* ---------- characters ---------- */
// 7px-wide Habbo-ish people: right-facing views; left is a mirror. Legs and arms are drawn per frame.
const HEAD_FRONT = ["..kkk..", ".kHHHk.", "kHHHHHk", "kHSeSek", "kSSSSsk", ".kSSsk."];
const HEAD_BACK = ["..kkk..", ".kHHHk.", "kHHHHHk", "kHHHHHk", "kHHHHhk", ".kSSsk."];
const TORSO = ["kchccCk", "kccccCk", "kccccCk", ".kpppk."];
const HARDHAT = ["..kkk..", ".kyyYk.", "kyyyyyYk"];
const BOT = [
  "...k...",
  "..kok..",
  ".kfffk.",
  "kfwffFk",
  "kfffffk",
  ".kkkkk.",
  "kgggggk",
  "kgcgcGk",
  "kgggggk",
  "kGGGGGk",
  ".kkkkk.",
];
export type WorkerRole = { reviewer: boolean; blueprint: boolean };
function drawWorker(ctx: Ctx, x: number, y: number, t: number, actor: string, isBot: boolean, dir: { x: number; y: number }, moving: boolean, working: boolean, role: WorkerRole) {
  const h = hash(actor);
  const frame = moving ? Math.floor(t * 9 + (h % 7)) % 4 : 0; // stand, stepA, stand, stepB
  const bob = moving ? (frame % 2) : working ? Math.floor(t * 6 + (h % 5)) % 2 : 0;
  poly(ctx, disc(x, y, 3.2, 0, 10), "rgba(26,28,44,0.45)");
  const [sx0, sy0] = proj(x, y, 0);
  const sx = Math.round(sx0), sy = Math.round(sy0);
  const sdx = dir.x - dir.y, front = dir.x + dir.y >= -0.01;
  const flip = sdx < 0;
  if (isBot) {
    // droid on treads with blinking antenna lights
    const blink = Math.floor(t * 3 + (h % 3)) % 2;
    const pal: Pal = { k: P.ink, o: blink ? P.red : P.lime, f: P.foam, F: shade(P.foam, 0.7), w: P.paper, g: "#94b0c2", G: P.steel, c: front ? P.cyan : "#94b0c2" };
    sprite(ctx, BOT, pal, sx, sy - 2 - bob, flip);
    const tr = Math.floor(t * 12) % 2;
    px(ctx, sx - 4, sy - 2, P.ink, 8, 2); px(ctx, sx - 3 + tr, sy - 2, P.slate, 1, 1); px(ctx, sx + 1 + tr, sy - 2, P.slate, 1, 1);
    if (Math.floor(t * 1.5 + h) % 3 === 0) px(ctx, sx + (flip ? -2 : 1), sy - 14 - bob, P.sand, 1, 1); // antenna spark
    return;
  }
  const shirt = SHIRTS[h % SHIRTS.length]!, hair = HAIR[(h >>> 4) % HAIR.length]!;
  const pants = (h >>> 9) % 2 ? P.slate : "#3b5dc9";
  const pal: Pal = {
    k: P.ink, H: hair, h: shade(hair, 0.75), S: P.skin, s: shade(P.skin, 0.8), e: P.ink,
    c: shirt, C: shade(shirt, 0.7), p: pants, y: P.butter, Y: shade(P.butter, 0.75),
  };
  const top = sy - 4 - bob; // bottom of torso
  // legs: 3px tall, one lifts and swings per step
  const legL = frame === 1 ? -1 : 0, legR = frame === 3 ? -1 : 0;
  const lx = sx - 2, rx = sx;
  px(ctx, lx, top + legL, P.ink, 2, 4 + legL); px(ctx, lx, top + legL, pants, 1, 2 + legL + 1);
  px(ctx, rx + 1, top + legR, P.ink, 2, 4 + legR); px(ctx, rx + 2, top + legR, shade(pants, 0.7), 1, 2 + legR + 1);
  sprite(ctx, TORSO, { ...pal, h: front ? shade(shirt, 1.3) : shirt }, sx, top + 1, flip);
  sprite(ctx, front ? HEAD_FRONT : HEAD_BACK, pal, sx, top - 3, flip);
  if (role.reviewer) sprite(ctx, HARDHAT, pal, sx + (flip ? -0.5 : 0.5), top - 6, flip);
  // arms swing opposite to legs; working arms tap the console
  const swing = moving ? (frame === 1 ? -1 : frame === 3 ? 1 : 0) : working ? -(Math.floor(t * 8 + h) % 2) : 0;
  const ax0 = Math.round(sx - 4), ax1 = Math.round(sx + 3), ay = top - 3;
  px(ctx, ax0, ay + swing, shade(shirt, 0.85), 1, 2); px(ctx, ax0, ay + 2 + swing, P.skin);
  px(ctx, ax1, ay - swing, shade(shirt, 0.7), 1, 2); px(ctx, ax1, ay + 2 - swing, P.skin);
  if (role.blueprint && front) {
    // rolled-out blueprint held in front
    const bx = sx + (flip ? -3 : 0), by = top - 2;
    px(ctx, bx - 1, by - 1, P.ink, 5, 4); px(ctx, bx, by, "#3b5dc9", 3, 2); px(ctx, bx, by, P.foam, 1, 1); px(ctx, bx + 2, by + 1, P.foam, 1, 1);
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

export function draw(ctx: Ctx, c: Compiled, w: WorldState, selected: string | null, selWorker: string | null = null, selIssue: string | null = null) {
  const t = w.t;
  const night = nightAt(w.realMs);
  const glows: [number, number, number][] = []; // light sources drawn after the night tint
  const beams: [number, number, number][] = [];
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
        px(ctx, rx - 1, ry, shade(P.butter, 0.7), 3, 2); px(ctx, rx - 1, ry, P.butter, 3, 1);
        const spin = Math.floor(t * 12 + s) % 4; // rivet orbits the roller hub
        px(ctx, rx - 1 + (spin === 1 ? 2 : spin === 3 ? 0 : 1), ry + (spin === 2 ? 1 : 0), P.ink);
      }
      // supports into the sea
      for (let s = s0 + 8; s < s1; s += 14) {
        const [sx2, sy2] = proj(ux * s + nx * side, uy * s + ny * side, -4);
        px(ctx, sx2, sy2, P.slate, 1, 5);
      }
    }
    // causeway streetlamp
    {
      const s = (s0 + s1) / 2, lx = ux * s - nx * 1.6, ly = uy * s - ny * 1.6;
      add(lx, ly, () => {
        const [a1, a2] = proj(lx, ly, 1);
        px(ctx, a1, a2 - 10, P.slate, 1, 10); px(ctx, a1 - 1, a2 - 11, P.ink, 3, 2);
        px(ctx, a1 - 1, a2 - 10, night > 0.3 ? "#ffe9a8" : P.sand, 3, 1);
        if (night > 0.3) glows.push([a1, a2 - 10, 6]);
      });
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
        const style = (hh >>> 3) % 3; // 0 brick, 1 panels, 2 stucco
        for (let f = 0; f < floors; f++) {
          const half = 4.4 - (f >= 3 ? 1 : 0) - (f >= 5 ? 0.8 : 0);
          box(ctx, bx, by, z, half, half, 4, col);
          // masonry: grout line under each floor, staggered bricks / panel seams
          const grout = shade(col, 0.82), grout2 = shade(col, 0.6);
          for (let k = -half; k < half; k += 1) {
            const [g1, g2] = proj(bx + k, by + half, z + 0.2); px(ctx, g1, g2, grout);
            const [g3, g4] = proj(bx + half, by + k, z + 0.2); px(ctx, g3, g4, grout2);
          }
          if (style === 0) for (let k = -half + 1 + (f % 2); k < half; k += 2) { const [m1, m2] = proj(bx + k, by + half, z + 1.4); px(ctx, m1, m2, grout); }
          if (style === 1) { const [m1, m2] = proj(bx, by + half, z + 2); px(ctx, m1, m2 - 1, grout, 1, 3); }
          // rim light on the front corner
          const [c1, c2] = proj(bx + half, by + half, z + 4); px(ctx, c1 - 1, c2, shade(col, 1.35), 1, 4);
          for (const wxo of [-2, 1.5]) {
            const lit = (hash(g.id + i + "w" + f + wxo) + Math.floor(t / 6)) % 3 !== 0;
            const [a1, a2] = proj(bx + wxo, by + half, z + 2.5);
            px(ctx, a1, a2, lit ? (night > 0.4 ? "#ffd27a" : P.sand) : P.ink, 1, 2);
            const [b1, b2] = proj(bx + half, by + wxo, z + 2.5);
            px(ctx, b1, b2, lit ? (night > 0.4 ? "#ffb54a" : P.foam) : P.ink, 1, 2);
            if (lit && night > 0.4) { glows.push([a1, a2, 3]); glows.push([b1, b2, 3]); }
          }
          z += 4;
        }
        const roofHalf = floors >= 5 ? 2.6 : floors >= 3 ? 3.4 : 4.4;
        box(ctx, bx, by, z, roofHalf * 0.7, roofHalf * 0.7, 1.5, P.red);
        // rooftop clutter: AC unit with spinning fan, water tank, or vent pipes
        const deco = (hh >>> 6) % 4;
        if (deco === 1) {
          box(ctx, bx - 1, by - 1, z + 1.5, 1.4, 1.4, 1.6, "#94b0c2");
          const [fx, fy] = proj(bx - 1, by - 1, z + 3.1); const sp = Math.floor(t * 8 + i) % 2;
          px(ctx, fx - 1 + sp, fy, P.ink, 2 - sp, 1); px(ctx, fx, fy - sp, P.ink, 1, 1 + sp);
        } else if (deco === 2 && floors >= 2) {
          const [lx2, ly2] = proj(bx + 1, by + 1, z + 1.5); px(ctx, lx2 - 1, ly2 - 2, P.ink, 1, 2); px(ctx, lx2 + 2, ly2 - 2, P.ink, 1, 2);
          box(ctx, bx + 1, by + 1, z + 3.5, 1.3, 1.3, 2.5, P.wood, "#c28553");
        } else if (deco === 3) {
          const [vx, vy] = proj(bx + 1, by - 1, z + 1.5); px(ctx, vx, vy - 3, P.steel, 1, 3); px(ctx, vx - 1, vy - 4, P.slate, 3, 1);
          if (Math.floor(t * 2 + i) % 3 === 0) px(ctx, vx, vy - 6, "#94b0c2");
        }
        if (floors >= 4) {
          const [ax, ay] = proj(bx, by, z + 1.5);
          px(ctx, ax, ay - 5, P.steel, 1, 5);
          if (Math.floor(t * 2 + i) % 2) { px(ctx, ax - 1, ay - 7, P.red, 3, 2); if (night > 0.3) glows.push([ax, ay - 6, 4]); }
        }
      });
    });
    // landmarks for big islands: a beacon buoy (20+ buildings), then a lighthouse (45+)
    const away = Math.atan2(g.y, g.x);
    if (b >= 20) {
      const bxw = g.x + Math.cos(away - 0.7) * (g.R + 6), byw = g.y + Math.sin(away - 0.7) * (g.R + 6);
      add(bxw, byw, () => {
        const [x1, y1] = proj(bxw, byw, 0); const rb = Math.round(Math.sin(t * 2 + gi) * 0.6);
        px(ctx, x1 - 3, y1, P.foam, 2, 1); px(ctx, x1 + 2, y1, P.foam, 2, 1);
        px(ctx, x1 - 2, y1 - 5 + rb, P.ink, 5, 5); px(ctx, x1 - 1, y1 - 5 + rb, P.grass, 3, 2); px(ctx, x1 - 1, y1 - 3 + rb, P.paper, 3, 1);
        px(ctx, x1, y1 - 9 + rb, P.ink, 1, 4);
        const on = Math.floor(t * 1.2 + gi) % 2;
        px(ctx, x1 - 1, y1 - 10 + rb, on ? P.lime : shade(P.lime, 0.5), 3, 2);
        if (on && night > 0.2) glows.push([x1, y1 - 10 + rb, 5]);
      });
    }
    if (b >= 45) {
      const lxw = g.x + Math.cos(away + 0.9) * (g.R - 4), lyw = g.y + Math.sin(away + 0.9) * (g.R - 4);
      add(lxw, lyw, () => {
        for (let k = 0; k < 6; k++) box(ctx, lxw, lyw, k * 3, 2.2 - k * 0.15, 2.2 - k * 0.15, 3, k % 2 ? P.red : P.paper);
        box(ctx, lxw, lyw, 18, 2.4, 2.4, 1, P.ink);
        const [l1, l2] = proj(lxw, lyw, 22);
        px(ctx, l1 - 2, l2 - 2, P.ink, 5, 4); px(ctx, l1 - 1, l2 - 1, night > 0.2 ? "#fff3b0" : P.sand, 3, 2);
        px(ctx, l1 - 1, l2 - 4, P.red, 3, 2);
        if (night > 0.2) {
          glows.push([l1, l2, 7]);
          // sweeping beam
          const a = t * 1.4 + gi;
          for (let r = 4; r < 46; r += 1.5) beams.push([l1 + Math.cos(a) * r, l2 + Math.sin(a) * r * 0.5, 1 - r / 46]);
        }
      });
    }
    // palm-ish tree for small islands
    const tx = g.x - dux * (g.R - 6), ty = g.y - duy * (g.R - 6);
    add(tx, ty, () => {
      const [sx, sy] = proj(tx, ty, 0);
      px(ctx, sx, sy - 9, P.wood, 1, 9);
      px(ctx, sx - 3, sy - 11, P.grass, 7, 2); px(ctx, sx - 1, sy - 12, P.lime, 3, 1);
    });
  });

  // factory: brick tower with sign + chimneys (back), themed per org
  const th = orgTheme(c.snapshot.org);
  add(-14, -37, () => {
    const TH = th.height;
    box(ctx, -14, -37, 0, 12, 9, TH, th.main, th.light);
    for (let z = 4; z < TH; z += 4) for (let x = -26 + ((z / 4) % 2) * 2; x < -2; x += 4) {
      const [bx, by] = proj(x, -28, z); px(ctx, bx, by, shade(th.main, 0.85), 2, 1);
    }
    const word = th.label;
    const x0 = -14 - (word.length * 4 - 1) / 2;
    for (let li = 0; li < word.length; li++) {
      const gl = GLYPHS[word[li]!]; if (!gl) continue;
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
        if (gl[gy]![gx] !== "1") continue;
        const [sx, sy] = proj(x0 + li * 4 + gx, -28, TH - 8 - gy * 2);
        px(ctx, sx, sy, th.sign, 1, 2);
        px(ctx, sx, sy + 2, th.dark, 1, 1);
      }
    }
    for (let z = 8; z < TH - 14; z += 8) { const [wx, wy] = proj(-2, -40, z); px(ctx, wx, wy, night > 0.4 ? "#ffd27a" : Math.floor(t * 2 + z) % 3 ? P.sand : P.foam, 2, 3); if (night > 0.4) glows.push([wx + 1, wy + 1, 4]); }
    // roof
    if (th.roof === "saw") for (let k = 0; k < 4; k++) box(ctx, -23 + k * 6, -37, TH, 2.5, 8, 3 + (k % 2) * 2, th.dark, th.light);
    else if (th.roof === "dome") for (let k = 0; k < 4; k++) box(ctx, -14, -37, TH + k * 2, 8 - k * 2, 6 - k * 1.4, 2, th.light);
    else if (th.roof === "spire") { box(ctx, -14, -37, TH, 4, 4, 6, th.dark); box(ctx, -14, -37, TH + 6, 2, 2, 6, th.light); const [sx, sy] = proj(-14, -37, TH + 12); px(ctx, sx, sy - 5, P.steel, 1, 5); if (Math.floor(t * 2) % 2) px(ctx, sx - 1, sy - 7, P.red, 3, 2); }
    else box(ctx, -14, -37, TH, 11, 8, 1.5, th.dark);
    for (let ci = 0; ci < th.chimneys; ci++) {
      const cx = -8 - ci * 7, cy = -42 + ci * 1;
      box(ctx, cx, cy, TH, 2.5, 2.5, 12, P.slate);
      box(ctx, cx, cy, TH + 12, 3, 3, 1.5, P.red);
      for (let k = 0; k < 4; k++) {
        const f = (t * 0.6 + k / 4 + ci * 0.33) % 1;
        const [sx, sy] = proj(cx + f * 10, cy - f * 6, TH + 16 + f * 22);
        const r = 2 + Math.floor(f * 4);
        px(ctx, sx - r / 2, sy - r / 2, f > 0.7 ? "#94b0c2" : P.paper, r, r);
      }
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
  // recycling furnace: closed PRs end up here
  const burning = w.scraps.length > 0;
  add(-40, 0, () => {
    box(ctx, -40, 0, 0, 4.5, 5.5, 11, "#7a3b3b", "#a0524a");
    for (let z = 2; z < 11; z += 3) for (let k = -4 + ((z / 3) % 2); k < 5; k += 3) { const [m1, m2] = proj(-40 + 4.5, k, z); px(ctx, m1, m2, "#5a2a2a", 2, 1); }
    // glowing mouth
    poly(ctx, [proj(-35.5, -2.5, 1), proj(-35.5, 2.5, 1), proj(-35.5, 2.5, 6), proj(-35.5, -2.5, 6)], P.ink);
    const fl = Math.floor(t * 10) % 3;
    const [m1, m2] = proj(-35.5, 0, 3);
    px(ctx, m1 - 2, m2 - 1, burning ? (fl ? P.butter : P.sand) : "#7a3b3b", 4, 3); if (burning || night > 0.3) px(ctx, m1 - 1, m2, burning ? P.paper : P.butter, 2, 1);
    if (burning || night > 0.3) glows.push([m1, m2, burning ? 8 : 4]);
    // hopper + stack
    box(ctx, -41, -1, 11, 3, 3, 2, P.slate); box(ctx, -42, 2, 11, 1.4, 1.4, 9, P.slate);
    const puffs = burning ? 5 : 2;
    for (let k = 0; k < puffs; k++) {
      const f = (t * (burning ? 1 : 0.4) + k / puffs) % 1, r = 1 + Math.floor(f * 3);
      const [sx2, sy2] = proj(-42 - f * 6, 2 - f * 4, 21 + f * 16);
      px(ctx, sx2 - r / 2, sy2 - r / 2, burning ? (f < 0.5 ? P.ink : P.slate) : "#94b0c2", r, r);
    }
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
    // at a workstation, face the console (it sits toward the machine)
    const wdir = working && !moving ? { x: -p.x, y: -p.y } : dir;
    const sel = wk.prId === selWorker;
    add(p.x, p.y, () => {
      if (sel) {
        const on = Math.floor(t * 6) % 2 ? P.foam : P.sand;
        for (const q2 of disc(p.x, p.y, 5, 0, 16)) px(ctx, q2[0], q2[1], on);
      }
      drawWorker(ctx, p.x, p.y, t, wk.actor, wk.isBot, wdir, moving, working, { reviewer: c.reviewers.has(wk.actor), blueprint: working });
      const [hx, hy] = proj(p.x, p.y, 17);
      if (wk.carrying && !working) {
        itemIcon(ctx, wk.kind, hx, hy);
        if (wk.stamped) sprite(ctx, SEAL, SEAL_PAL, hx + 4, hy - 1);
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

  // inspectors at docks: Snapie zips down, extends a stamping arm and seals the parcel in gold
  for (const b of w.inspectors) {
    const p = toW(b);
    const k = Math.max(0, Math.min(1, b.k));
    add(p.x, p.y, () => {
      const z = k < 0.3 ? 44 - (k / 0.3) * 20 : k < 0.7 ? 24 : 24 + ((k - 0.7) / 0.3) * 22;
      const [sx, sy] = proj(p.x - 6, p.y + 6, z + Math.sin(t * 8) * 0.8);
      const [tx2, ty2] = proj(p.x - 6, p.y + 6, 19); // parcel top over the queued worker
      // arm: extends during the stamp window
      const ext = k < 0.3 ? 0 : k < 0.45 ? (k - 0.3) / 0.15 : k < 0.6 ? 1 : k < 0.7 ? 1 - (k - 0.6) / 0.1 : 0;
      if (ext > 0) {
        const len = Math.round((ty2 - sy - 4) * ext);
        px(ctx, sx, sy + 3, P.steel, 1, Math.max(1, len)); px(ctx, sx - 1, sy + 3 + len, P.slate, 3, 2);
      }
      if (k >= 0.45 && k < 0.62) {
        sprite(ctx, SEAL, SEAL_PAL, tx2, ty2 + 2);
        for (let r = 0; r < 6; r++) { const a = (r / 6) * Math.PI * 2 + t * 4; px(ctx, tx2 + Math.cos(a) * 7, ty2 - 2 + Math.sin(a) * 4, r % 2 ? P.sand : P.paper); }
        glows.push([tx2, ty2 - 2, 6]);
      }
      // speed lines while zipping
      if (k < 0.3 || k > 0.7) for (let r = 1; r < 4; r++) px(ctx, sx - 1 + (r % 2) * 2, sy - 4 - r * 3 * (k < 0.3 ? 1 : -1), P.foam);
      drawBee(ctx, sx, sy, t);
    });
  }
  // closed PRs: a trapdoor opens, the parcel drops, soot puffs up
  for (const s2 of w.scraps) {
    const p = toW(s2);
    const k = Math.max(0, Math.min(1, s2.k));
    add(p.x, p.y, () => {
      const open = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1;
      const hw = 3.5 * open;
      if (hw > 0.3) poly(ctx, [proj(p.x - hw, p.y - hw, 0.2), proj(p.x + hw, p.y - hw, 0.2), proj(p.x + hw, p.y + hw, 0.2), proj(p.x - hw, p.y + hw, 0.2)], P.ink);
      const [sx, sy] = proj(p.x, p.y, 0);
      if (k < 0.45) { // parcel falling into the hatch
        const drop = Math.round((k / 0.45) * 10);
        ctx.save(); ctx.beginPath(); ctx.rect(sx - 8, sy - 30, 16, 30); ctx.clip();
        px(ctx, sx - 2, sy - 12 + drop, P.ink, 5, 5); px(ctx, sx - 1, sy - 11 + drop, P.butter, 3, 3);
        ctx.restore();
      }
      if (k > 0.3) for (let r = 0; r < 4; r++) {
        const f = Math.min(1, (k - 0.3) / 0.7 + r * 0.1), sz = 1 + Math.floor(f * 3);
        px(ctx, sx - 4 + r * 3 - sz / 2, sy - 3 - f * 12 - (r % 2) * 2, r % 2 ? P.slate : P.ink, sz, sz);
      }
    });
  }

  // sea life: bugs, enhancement tugboats, task rowboats
  const tugs = w.creatures.filter((cr) => cr.kind === "enhancement" && cr.phase === "active");
  for (const cr of w.creatures) {
    const p = toW(cr.pos);
    // wakes go on the water first so every boat sits on top of any wake
    if (cr.kind !== "bug") items.push({ d: -1e6, fn: () => drawWake(ctx, cr, t) });
    if (cr.anchor) { const a = toW(cr.anchor); add(a.x, a.y, () => drawBuoy(ctx, a.x, a.y, t, cr.seed)); }
    const honk = cr.kind === "enhancement" && tugs.some((o) => o.id !== cr.id && Math.hypot(toW(o.pos).x - p.x, toW(o.pos).y - p.y) < 18);
    add(p.x, p.y, () => drawCreature(ctx, cr, p.x, p.y, t, cr.id === selIssue, honk));
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

  // day / night: tint the whole scene, then let the lights punch through
  if (night > 0.01) {
    ctx.fillStyle = `rgba(14,16,44,${(0.55 * night).toFixed(3)})`;
    ctx.fillRect(0, 0, RW, RH);
    for (const [bx, by, a] of beams) { ctx.fillStyle = `rgba(255,243,176,${(0.35 * a * night).toFixed(3)})`; ctx.fillRect(Math.round(bx) - 1, Math.round(by), 3, 1); }
    for (const [gx, gy, r] of glows) {
      ctx.fillStyle = `rgba(255,205,117,${(0.13 * night).toFixed(3)})`;
      for (let yy = -r; yy <= r; yy++) { const ww = Math.round(Math.sqrt(r * r - yy * yy)); ctx.fillRect(Math.round(gx) - ww, Math.round(gy) + yy, ww * 2 + 1, 1); }
      px(ctx, gx, gy, "#ffe9a8", 1, 1);
    }
  }

  if (w.hidden) badge(ctx, `+${w.hidden}`, 16, RH - 14);
}

/** Screen-space hit test for sea life. */
export function creatureAt(w: WorldState, sx: number, sy: number): string | null {
  let best: { id: string; d: number } | null = null;
  for (const cr of w.creatures) {
    const p = toW(cr.pos);
    const [x, y] = proj(p.x, p.y, 0);
    if (Math.abs(sx - x) <= 8 && sy <= y + 4 && sy >= y - 14) {
      const d = Math.hypot(sx - x, sy - (y - 4));
      if (!best || d < best.d) best = { id: cr.id, d };
    }
  }
  return best?.id ?? null;
}

/* ---------- sprites ---------- */
type Pal = Record<string, string>;
/** Draw a pixel sprite anchored at its bottom-centre; '.' is transparent. */
function sprite(ctx: Ctx, rows: string[], pal: Pal, x: number, y: number, flip = false) {
  const h = rows.length, w = rows[0]!.length;
  const x0 = Math.round(x - w / 2), y0 = Math.round(y - h);
  for (let r = 0; r < h; r++) {
    const row = rows[r]!;
    for (let c = 0; c < w; c++) {
      const ch = row[flip ? w - 1 - c : c]!;
      if (ch === ".") continue;
      const col = pal[ch]; if (!col) continue;
      ctx.fillStyle = col; ctx.fillRect(x0 + c, y0 + r, 1, 1);
    }
  }
}
const SEAL = ["..kkk..", ".kyyyk.", "kyYwYyk", "kyYYYyk", ".kyyyk.", "..kkk.."];
const SEAL_PAL: Pal = { k: P.ink, y: "#d9a046", Y: P.sand, w: P.paper };
const TUG = [
  "...........kk......",
  "..........kssk.....",
  "..........kook.....",
  "..........kSsk.....",
  ".....kkkkkkkkkk....",
  ".....kwwwwwwwwk....",
  ".....kwccwwccwk....",
  ".kkkkkwccwwccwk....",
  ".kblbkwwwwwwwgk..kk",
  ".kbbbkggggggggk.khk",
  "kkkkkkkkkkkkkkkkkhk",
  "khhhhhhhhhhhhhhhhhk",
  ".kwwwwwwwwwwwwwwwk.",
  "..kRRRRRRRRRRRRRk..",
  "...kkkkkkkkkkkkk...",
];
const ROWBOAT = [
  ".....kk........",
  "....kHHk.......",
  "....kSSk.......",
  "...kcccck.kk...",
  "...kcCcck.kwk..",
  "kkkkkkkkkkkykkk",
  "khhhhhhhhhhhhhk",
  ".kbbbbbbbbbbbk.",
  "..kBBBBBBBBBk..",
  "...kkkkkkkkk...",
];
const TUG_PAL: Pal = {
  k: P.ink, s: P.slate, S: shade(P.slate, 0.7), o: P.butter, w: P.paper, c: P.cyan, g: "#94b0c2",
  b: P.wood, l: "#c28553", h: shade(P.red, 1.3), R: shade(P.red, 0.75), r: P.red,
};
const screenVel = (v: Pt) => ({ x: v.x - v.y, y: (v.x + v.y) / 2 });

/** 3-step fading foam wake behind a moving boat, plus stern churn. */
function drawWake(ctx: Ctx, cr: CreatureState, t: number) {
  const sv = screenVel(cr.vel);
  const sp = Math.hypot(sv.x, sv.y);
  if (sp < 1.2) return;
  const nx = -sv.y / sp, ny = sv.x / sp;
  const cols = [P.foam, shade(P.foam, 0.7), "#4e6fd6"];
  cr.trail.forEach((q, i) => {
    const w = toW(q); const [x, y] = proj(w.x, w.y, 0);
    const spread = 2 + i * 2.2;
    px(ctx, x + nx * spread, y + ny * spread * 0.6, cols[i]!, i < 2 ? 2 : 1, 1);
    px(ctx, x - nx * spread, y - ny * spread * 0.6, cols[i]!, i < 2 ? 2 : 1, 1);
  });
  const p = toW(cr.pos); const [x, y] = proj(p.x, p.y, 0);
  const bx = x - (sv.x / sp) * 9, by = y - (sv.y / sp) * 4;
  const f = Math.floor(t * 10 + cr.seed) % 3;
  px(ctx, bx - 1 + f, by, P.paper); px(ctx, bx + 1 - f, by + 1, P.foam, 2, 1);
}

function drawBuoy(ctx: Ctx, wx: number, wy: number, t: number, seed: number) {
  const [x0, y0] = proj(wx, wy, 0);
  const x = Math.round(x0), y = Math.round(y0) + Math.round(Math.sin(t * 2.4 + seed) * 0.6);
  px(ctx, x - 3, y, shade(P.foam, 0.8), 2, 1); px(ctx, x + 2, y, shade(P.foam, 0.8), 2, 1);
  px(ctx, x - 2, y - 4, P.ink, 5, 4); px(ctx, x - 1, y - 4, P.red, 3, 1); px(ctx, x - 1, y - 3, P.paper, 3, 1); px(ctx, x - 1, y - 2, P.red, 3, 1);
  px(ctx, x, y - 7, P.ink, 1, 3);
  if (Math.floor(t * 1.5 + seed) % 2) { px(ctx, x - 1, y - 9, P.sand, 3, 2); px(ctx, x, y - 10, P.paper); }
}

function drawCreature(ctx: Ctx, cr: CreatureState, wx: number, wy: number, t: number, sel: boolean, honk: boolean) {
  const [x0, y0] = proj(wx, wy, 0);
  const bob = Math.round(Math.sin(t * 3 + cr.seed) * 0.8);
  const x = Math.round(x0), y = Math.round(y0);
  const sv = screenVel(cr.vel);
  const face = Math.abs(sv.x) > 0.3 ? (sv.x > 0 ? 1 : -1) : (cr.seed % 2 ? 1 : -1);
  if (sel) { const on = Math.floor(t * 6) % 2 ? P.foam : P.sand; for (const q of disc(wx, wy, 9, 0, 20)) px(ctx, q[0], q[1], on); }
  if (cr.kind === "bug") return drawBug(ctx, cr, x, y, t, face);
  // waterline lap
  const rk = Math.floor(t * 3 + cr.seed) % 3;
  if (cr.kind === "enhancement") {
    px(ctx, x - 10 - rk, y, P.foam, 2, 1); px(ctx, x + 9 + rk, y, P.foam, 2, 1);
    sprite(ctx, TUG, TUG_PAL, x, y + 1 + bob, face < 0);
    // steam from the stack (drifts aft)
    const sx = x + face * 2, puffs = cr.phase === "resolving" ? 5 : 3;
    for (let k = 0; k < puffs; k++) {
      const f = (t * 0.8 + k / puffs) % 1, r = 1 + Math.floor(f * 3);
      px(ctx, sx - face * f * 7 - r / 2, y - 16 + bob - f * 9, cr.phase === "resolving" || honk ? P.paper : "#94b0c2", r, r);
    }
    if (honk && Math.floor(t * 4 + cr.seed) % 3 !== 0) {
      px(ctx, sx - 2, y - 26 + bob, P.paper, 5, 7); px(ctx, sx - 3, y - 25 + bob, P.paper, 7, 5);
      pixText(ctx, "!", sx - 1, y - 25 + bob, P.red);
    }
    return;
  }
  // task rowboat: a rower pulling oars, scroll cargo up front
  px(ctx, x - 8 - rk, y, P.foam, 2, 1); px(ctx, x + 7 + rk, y, P.foam, 2, 1);
  const h = cr.seed;
  const pal: Pal = { k: P.ink, H: HAIR[h % HAIR.length]!, S: P.skin, c: SHIRTS[(h >>> 3) % SHIRTS.length]!, C: shade(SHIRTS[(h >>> 3) % SHIRTS.length]!, 0.7),
    w: P.paper, y: P.sand, h: "#d99a62", b: P.wood, B: shade(P.wood, 0.7) };
  sprite(ctx, ROWBOAT, pal, x, y + 1 + bob, face < 0);
  const stroke = Math.floor(t * 3 + h) % 2;
  const ox = x - face * 2, oy = y - 5 + bob; // oarlock near the rower
  if (stroke) { // blade in the water + splash
    for (let k = 0; k < 4; k++) px(ctx, ox - face * k, oy + k, P.wood);
    px(ctx, ox - face * 4 - 1, oy + 4, P.foam, 3, 1); px(ctx, ox - face * 6, oy + 3, P.paper);
  } else { // recovering, blade up
    for (let k = 0; k < 4; k++) px(ctx, ox + face * k, oy - k + 1, P.wood);
    px(ctx, ox + face * 4, oy - 3, "#c28553", 2, 2);
  }
}

/** Glitch kraken. Grows (and sprouts tentacles) the longer its issue stays open. */
function drawBug(ctx: Ctx, cr: CreatureState, x: number, y: number, t: number, face: number) {
  const tier = cr.age < 3 ? 0 : cr.age < 10 ? 1 : 2;
  const bw = 9 + tier * 2, bh = 7 + tier;
  const sinkA = cr.phase === "arriving" ? (1 - cr.k) : cr.phase === "resolving" ? cr.k : 0;
  const sink = Math.round(Math.max(sinkA, cr.dive) * (bh + 4));
  const bob = Math.round(Math.sin(t * 2.2 + cr.seed) * 1);
  const top = y - bh - 2 + bob + sink;
  const body = cr.seed % 2 ? P.purple : "#7b2f7b", hi = shade(body, 1.35), lo = shade(body, 0.7);
  const paint = () => {
    const x0 = x - Math.floor(bw / 2);
    // body: rounded blob with 3-tone shading
    px(ctx, x0 + 1, top, P.ink, bw - 2, 1); px(ctx, x0, top + 1, P.ink, bw, bh);
    px(ctx, x0 + 1, top + 1, body, bw - 2, bh - 1);
    px(ctx, x0 + 1, top + 1, hi, bw - 3, 1); px(ctx, x0 + 1, top + 2, hi, 1, 2);
    px(ctx, x0 + 1, top + bh - 1, lo, bw - 2, 1);
    // antennae
    px(ctx, x0 + 2, top - 2, P.lime, 1, 2); px(ctx, x0 + bw - 3, top - 2, P.lime, 1, 2);
    if (Math.floor(t * 3 + cr.seed) % 2) { px(ctx, x0 + 2, top - 3, P.paper); px(ctx, x0 + bw - 3, top - 3, P.paper); }
    // eyes look where it's heading
    const blink = Math.floor(t * 2 + cr.seed) % 7 === 0, ey = top + 2, look = face > 0 ? 1 : 0;
    for (const ex of [x - 3 - tier * 0.5, x + 1 + tier * 0.5]) {
      px(ctx, ex, ey, blink ? body : P.paper, 2, 2);
      if (!blink) px(ctx, ex + look, ey + 1, P.ink);
    }
    // jagged mouth with teeth
    px(ctx, x - 2, top + bh - 3, P.ink, 5, 2); px(ctx, x - 1, top + bh - 3, P.paper); px(ctx, x + 1, top + bh - 3, P.paper);
    px(ctx, x, top + bh - 2, P.red);
    // tentacles: 2, 3 or 4 depending on age
    const n = 2 + tier;
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 1 : -1, row = Math.floor(k / 2);
      const wv = Math.floor(t * 4 + k + cr.seed) % 2;
      const tx = side > 0 ? x0 + bw + row : x0 - 1 - row, ty = top + 3 + row * 2 + wv;
      px(ctx, tx, ty, P.lime, 1, 3); px(ctx, tx + side, ty - 1 + wv, P.lime); px(ctx, tx, ty + 3, shade(P.lime, 0.7));
    }
    // glitch: torn scanlines
    if (Math.floor(t * 9 + cr.seed) % (tier === 2 ? 3 : 5) === 0) { px(ctx, x0 + 2, top + 4, P.foam, 3, 1); px(ctx, x0 + bw - 4, top + 2, "#73eff7", 2, 1); }
  };
  // above water: full colour; below the waterline: a dim ghost
  ctx.save(); ctx.beginPath(); ctx.rect(x - 14, top - 6, 28, y - top + 7); ctx.clip(); paint(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(x - 14, y + 1, 28, 20); ctx.clip(); ctx.globalAlpha = 0.28; paint(); ctx.restore();
  // waterline ripple ring
  const rk = Math.floor(t * 3 + cr.seed) % 3, half = Math.floor(bw / 2) + 2;
  px(ctx, x - half - rk, y + 1, P.foam, 2 + (rk === 0 ? 1 : 0), 1); px(ctx, x + half - 1 + rk, y + 1, P.foam, 2, 1);
  if (sink > 2) px(ctx, x - 2, y + 1, shade(P.foam, 0.8), 5, 1);
  // bubbles while diving, surfacing or being squashed
  if (cr.dive > 0.05 || cr.phase !== "active") {
    const nB = cr.phase === "resolving" ? 6 : 3;
    for (let k = 0; k < nB; k++) { const f = (t * 1.5 + k / nB + cr.seed * 0.001) % 1; px(ctx, x - 3 + ((k * 3) % 7), y - f * 10, P.foam, 1 + (k % 2), 1 + (k % 2)); }
  }
}
