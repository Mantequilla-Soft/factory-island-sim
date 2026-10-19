import type { ActivityEvent, Issue, IssueKind, ItemKind, Snapshot } from "./types";

export const W = 320;
export const H = 192;
export const DURATION = 75; // playback seconds per week at 1x
export const WALK = 0.8; // playback seconds per walk leg / min dwell

export type Pt = { x: number; y: number };
export const FACTORY: Pt = { x: 160, y: 96 };

/* ---------- time mapping: busy hours weigh more than nights/weekends ---------- */
export type Timeline = { start: number; end: number; cum: number[] }; // cum per hour
function hourWeight(ms: number) {
  const d = new Date(ms);
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  if (day === 0 || day === 6) return 0.2;
  return h >= 8 && h < 20 ? 1 : 0.3;
}
export function buildTimeline(s: Snapshot): Timeline {
  const start = Date.parse(s.weekStart);
  const end = Date.parse(s.weekEnd);
  const hours = Math.ceil((end - start) / 3600_000);
  const cum: number[] = [0];
  for (let i = 0; i < hours; i++) cum.push(cum[i]! + hourWeight(start + i * 3600_000));
  return { start, end, cum };
}
export function realToPlay(tl: Timeline, ms: number) {
  const hf = Math.max(0, Math.min(tl.cum.length - 1, (ms - tl.start) / 3600_000));
  const i = Math.min(Math.floor(hf), tl.cum.length - 2);
  const v = tl.cum[i]! + (tl.cum[i + 1]! - tl.cum[i]!) * (hf - i);
  return (v / tl.cum[tl.cum.length - 1]!) * DURATION;
}
export function playToReal(tl: Timeline, sec: number) {
  const target = (Math.max(0, Math.min(DURATION, sec)) / DURATION) * tl.cum[tl.cum.length - 1]!;
  let lo = 0, hi = tl.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tl.cum[m]! <= target) lo = m; else hi = m; }
  const span = tl.cum[hi]! - tl.cum[lo]! || 1;
  return tl.start + (lo + (target - tl.cum[lo]!) / span) * 3600_000;
}

/* ---------- layout ---------- */
export type IslandLayout = { id: string; center: Pt; dock: Pt; r: number };
export function layoutIslands(s: Snapshot): IslandLayout[] {
  const n = s.repos.length;
  return s.repos.map((repo, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const center = { x: 160 + Math.cos(a) * 122, y: 96 + Math.sin(a) * 70 };
    const dock = { x: 160 + Math.cos(a) * 92, y: 96 + Math.sin(a) * 50 };
    return { id: repo.id, center, dock, r: 16 };
  });
}
export function stationPos(i: number): Pt {
  const a = (i / 8) * Math.PI * 2;
  return { x: 160 + Math.cos(a) * 30, y: 96 + Math.sin(a) * 20 };
}
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/* ---------- precompiled PR timelines ---------- */
export type PrStep = { at: number; ev: ActivityEvent };
export type Compiled = {
  snapshot: Snapshot;
  tl: Timeline;
  islands: IslandLayout[];
  prs: { prId: string; repo: string; actor: string; kind: ItemKind; station: number; steps: PrStep[] }[];
  feed: PrStep[];
  issues: { issue: Issue; open: number; close: number | null; angle: number; dist: number }[];
  /** play-times of merges per repo id (sorted), for smooth island growth */
  merges: Map<string, number[]>;
  /** people who reviewed at least one PR this week */
  reviewers: Set<string>;
};

/* ---------- iso world units (shared with render) ---------- */
export const toWorld = (p: Pt): Pt => ({ x: p.x - 160, y: (p.y - 96) * 1.75 });
export const fromWorld = (w: Pt): Pt => ({ x: w.x + 160, y: w.y / 1.75 + 96 });
/** island land radius in world units for a building count */
export const islandRadius = (buildings: number) => Math.min(30, 17 + Math.sqrt(Math.max(0, buildings)) * 1.4);
export const PLATFORM = 47; // factory platform half-size, world units

export function compile(s: Snapshot): Compiled {
  const tl = buildTimeline(s);
  const byPr = new Map<string, ActivityEvent[]>();
  for (const e of s.events) {
    if (!byPr.has(e.prId)) byPr.set(e.prId, []);
    byPr.get(e.prId)!.push(e);
  }
  const prs = [...byPr.entries()].map(([prId, evs]) => {
    let last = -Infinity;
    const steps = evs.map((ev) => {
      // enforce minimum on-screen dwell per stage
      const at = Math.max(realToPlay(tl, Date.parse(ev.at)), last + WALK);
      last = at;
      return { at, ev };
    });
    return { prId, repo: evs[0]!.repo, actor: evs[0]!.actor, kind: evs[0]!.itemKind, station: hash(prId) % 8, steps };
  });
  const feed = prs.flatMap((p) => p.steps).sort((a, b) => a.at - b.at);
  const islands = layoutIslands(s);
  const isl = new Map(islands.map((i) => [i.id, i]));
  const merges = new Map<string, number[]>(s.repos.map((r) => [r.id, []]));
  for (const p of prs) for (const st of p.steps) if (st.ev.type === "pr_merged") merges.get(p.repo)?.push(st.at);
  for (const m of merges.values()) m.sort((a, b) => a - b);
  const reviewers = new Set(s.events.filter((e) => e.type === "review_approved" || e.type === "review_changes_requested").map((e) => e.actor));
  // cap the sea life so huge backlogs don't sink the frame rate; newest first
  const MAX_CREATURES = 80;
  const src = [...(s.issues ?? [])].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, MAX_CREATURES);
  const issues = src.filter((x) => isl.has(x.repo)).map((issue) => {
    const h = hash(issue.id);
    const open = realToPlay(tl, Date.parse(issue.openedAt));
    const close = issue.closedAt ? Math.max(open + WALK * 3, realToPlay(tl, Date.parse(issue.closedAt))) : null;
    // angle: offset within the seaward arc; dist: extra water beyond the clearance ring
    return { issue, open, close, angle: ((h % 1000) / 1000 - 0.5) * 2, dist: (h >>> 10) % 7 };
  });
  return { snapshot: s, tl, islands, prs, feed, issues, merges, reviewers };
}

/** Smoothly growing building count at play-time t (each merge eases in over one WALK). */
export function buildingsAt(c: Compiled, repo: string, t: number) {
  const base = c.snapshot.repos.find((r) => r.id === repo)?.mergedTotal ?? 0;
  let n = 0;
  for (const at of c.merges.get(repo) ?? []) { if (at > t) break; n += Math.min(1, (t - at) / WALK); }
  return base + n;
}

/* ---------- pure world state ---------- */
export type WorkerPhase = "fabricating" | "carrying" | "queued" | "stamped" | "delivering" | "returning" | "scrapping" | "rework";
export type WorkerState = { prId: string; repo: string; slot: number; actor: string; isBot: boolean; kind: ItemKind; pos: Pt; phase: WorkerPhase; carrying: boolean; stamped: boolean; progress: number };
export type IslandState = { id: string; buildings: number; mergedThisWeek: number; recent: { kind: ItemKind; prId: string }[]; queue: number };
export type CreaturePhase = "arriving" | "active" | "resolving";
/**
 * Sea life for an issue. k is 0..1 progress through arriving/resolving.
 * pos/trail/anchor are sim coords; vel is world units per playback second.
 * dive: 0 surfaced .. 1 fully under water (bugs). age: days the issue has been open at t.
 */
export type CreatureState = {
  id: string; repo: string; kind: IssueKind; pos: Pt; phase: CreaturePhase; k: number; seed: number;
  vel: Pt; trail: Pt[]; dive: number; age: number; anchor?: Pt;
};
export type WorldState = { t: number; realMs: number; workers: WorkerState[]; islands: IslandState[]; inspectors: (Pt & { k: number })[]; scraps: (Pt & { k: number })[]; hidden: number; creatures: CreatureState[] };

export const ISSUE_ENTER = WALK * 2.5;
export const ISSUE_LEAVE = WALK * 2;
/** minimum water between an island's sand edge and any sea life, world units */
export const SEA_CLEARANCE = 9;
const smooth = (e: number) => { const k = Math.max(0, Math.min(1, e)); return k * k * (3 - 2 * k); };

type IslandCtx = { id: string; c: Pt; R: number; away: number };
/** keep a world point in open water: off every island (incl. clearance) and off the factory platform */
function keepInWater(p: Pt, isl: IslandCtx[]): Pt {
  let { x, y } = p;
  for (let pass = 0; pass < 2; pass++) {
    for (const I of isl) {
      const dx = x - I.c.x, dy = y - I.c.y, d = Math.hypot(dx, dy) || 0.001, min = I.R + SEA_CLEARANCE;
      if (d < min) { x = I.c.x + (dx / d) * min; y = I.c.y + (dy / d) * min; }
    }
    const m = PLATFORM + 6;
    if (Math.abs(x) < m && Math.abs(y) < m) {
      if (Math.abs(x) > Math.abs(y)) x = Math.sign(x || 1) * m; else y = Math.sign(y || 1) * m;
    }
  }
  return { x, y };
}

/** Pure position of one creature in world units at play-time t. */
function creatureWorld(c: Compiled, x: Compiled["issues"][number], I: IslandCtx, isl: IslandCtx[], t: number): { p: Pt; anchor: Pt | undefined; dive: number } {
  const seed = hash(x.issue.id);
  const ph = (seed % 6283) / 1000; // phase 0..2π
  const n = c.islands.length;
  const arc = n <= 6 ? 1.9 : 1.9 * (6 / n); // half-width of the seaward arc, radians
  const at = (a: number, r: number): Pt => ({ x: I.c.x + Math.cos(a) * r, y: I.c.y + Math.sin(a) * r });
  let p: Pt, anchor: Pt | undefined, dive = 0, ang: number, r: number;
  if (x.issue.kind === "enhancement") {
    // tugboat: sweeps back and forth along the seaward shipping lane, turning at each end
    const w = 0.12 + (seed % 7) * 0.012;
    ang = I.away + arc * Math.sin(w * t + ph);
    r = I.R + SEA_CLEARANCE + 5 + x.dist * 0.6;
    p = at(ang, r);
  } else if (x.issue.kind === "task") {
    // rowboat: lazy laps around its own buoy, the buoy drifting slowly along the lane
    ang = I.away + x.angle * arc * 0.8 + Math.sin(t * 0.04 + ph) * 0.25;
    r = I.R + SEA_CLEARANCE + 9 + x.dist;
    const a0 = at(ang, r);
    anchor = keepInWater(a0, isl);
    const dir = seed % 2 ? 1 : -1, w = 0.5 + (seed % 5) * 0.06;
    p = { x: anchor.x + Math.cos(w * t * dir + ph) * 6, y: anchor.y + Math.sin(w * t * dir + ph) * 6 };
  } else {
    // bug monster: skulks slowly, darts in sudden lunges, dives under now and then
    const Pd = 5 + (seed % 4), kk = Math.floor((t + ph) / Pd), u = ((t + ph) % Pd) / Pd;
    const tgt = (k: number) => ((hash(x.issue.id + k) % 1000) / 1000 - 0.5) * 2;
    const dart = tgt(kk - 1) + (tgt(kk) - tgt(kk - 1)) * smooth((u - 0.78) / 0.12);
    ang = I.away + x.angle * arc * 0.5 + Math.sin(t * 0.07 + ph) * 0.3 + dart * 0.45;
    r = I.R + SEA_CLEARANCE + 3 + x.dist + Math.sin(t * 0.9 + ph) * 1.2;
    p = at(ang, r);
    const Pv = 9 + (seed % 5), v = ((t + ph * 2) % Pv) / Pv;
    dive = v < 0.6 ? 0 : v < 0.72 ? (v - 0.6) / 0.12 : v < 0.84 ? 1 : 1 - (v - 0.84) / 0.16;
    dive = smooth(dive);
  }
  // arriving / resolving: boats sail in from the open sea and back out; bugs surface / sink
  const far = at(ang, r + 60);
  if (x.issue.kind !== "bug") {
    if (t - x.open < ISSUE_ENTER) { const k = smooth((t - x.open) / ISSUE_ENTER); p = { x: far.x + (p.x - far.x) * k, y: far.y + (p.y - far.y) * k }; }
    else if (x.close !== null && t >= x.close) { const k = smooth((t - x.close) / ISSUE_LEAVE); p = { x: p.x + (far.x - p.x) * k, y: p.y + (far.y - p.y) * k }; }
  }
  return { p: keepInWater(p, isl), anchor, dive };
}

export function creaturesAt(c: Compiled, t: number): CreatureState[] {
  const isl: IslandCtx[] = c.islands.map((I) => {
    const cw = toWorld(I.center);
    return { id: I.id, c: cw, R: islandRadius(buildingsAt(c, I.id, t)), away: Math.atan2(cw.y, cw.x) };
  });
  const byId = new Map(isl.map((i) => [i.id, i]));
  const realNow = playToReal(c.tl, t);
  const out: CreatureState[] = [];
  for (const x of c.issues) {
    if (x.open > t) continue;
    if (x.close !== null && t > x.close + ISSUE_LEAVE) continue;
    const I = byId.get(x.issue.repo)!;
    const seed = hash(x.issue.id);
    let phase: CreaturePhase = "active", k = 1;
    if (x.close !== null && t >= x.close) { phase = "resolving"; k = (t - x.close) / ISSUE_LEAVE; }
    else if (t - x.open < ISSUE_ENTER) { phase = "arriving"; k = (t - x.open) / ISSUE_ENTER; }
    const now = creatureWorld(c, x, I, isl, t);
    const back = creatureWorld(c, x, I, isl, t - 0.1).p;
    const trail = [0.3, 0.6, 0.9].map((d) => fromWorld(creatureWorld(c, x, I, isl, Math.max(x.open, t - d)).p));
    out.push({
      id: x.issue.id, repo: x.issue.repo, kind: x.issue.kind, pos: fromWorld(now.p), phase, k: Math.max(0, Math.min(1, k)), seed,
      vel: { x: (now.p.x - back.x) / 0.1, y: (now.p.y - back.y) / 0.1 }, trail, dive: now.dive,
      age: Math.max(0, (realNow - Date.parse(x.issue.openedAt)) / 86_400_000),
      ...(now.anchor ? { anchor: fromWorld(now.anchor) } : {}),
    });
  }
  return out;
}

const MAX_WORKERS = 24;
const lerp = (a: Pt, b: Pt, k: number): Pt => {
  const e = Math.max(0, Math.min(1, k));
  const s = e * e * (3 - 2 * e);
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
};

export function stateAt(c: Compiled, t: number): WorldState {
  const isle = new Map(c.islands.map((i) => [i.id, i]));
  const islandState = new Map<string, IslandState>(
    c.snapshot.repos.map((r) => [r.id, { id: r.id, buildings: r.mergedTotal, mergedThisWeek: 0, recent: [], queue: 0 }]),
  );
  const bots = new Set(c.snapshot.people.filter((p) => p.isBot).map((p) => p.id));
  // dock queue: PRs whose current phase is at the dock, FIFO by ready time
  const queues = new Map<string, { prId: string; since: number }[]>();
  type Pending = { pr: Compiled["prs"][number]; from: Pt; toKey: string; start: number; phase: WorkerPhase; stamped: boolean; carrying: boolean };
  const pending: Pending[] = [];
  const inspectors: (Pt & { k: number })[] = [];
  const scraps: (Pt & { k: number })[] = [];

  for (const pr of c.prs) {
    const first = pr.steps[0]!;
    if (first.at > t) continue;
    const I = isle.get(pr.repo)!;
    const station = stationPos(pr.station);
    const targetOf = (k: string): Pt => (k === "station" ? station : k === "island" ? I.center : k === "factory" ? FACTORY : I.dock);
    let from = FACTORY, toKey = "station", start = first.at, phase: WorkerPhase = "fabricating", stamped = false, carrying = true, readyAt = 0, done = false;
    for (const st of pr.steps) {
      if (st.at > t) break;
      const cur = lerp(from, targetOf(toKey), (st.at - start) / WALK);
      from = cur; start = st.at;
      switch (st.ev.type) {
        case "pr_opened": toKey = "station"; phase = "fabricating"; break;
        case "pr_ready_for_review": toKey = "dock"; phase = "carrying"; readyAt = st.at; break;
        case "review_changes_requested": toKey = "station"; phase = "rework"; stamped = false; break;
        case "review_approved":
          toKey = "dock"; phase = "stamped"; stamped = true;
          if (t - st.at < WALK * 1.5) inspectors.push({ x: I.dock.x + 6, y: I.dock.y - 6, k: (t - st.at) / (WALK * 1.5) });
          break;
        case "pr_merged": {
          toKey = "island"; phase = "delivering";
          const is = islandState.get(pr.repo)!;
          is.buildings++; is.mergedThisWeek++;
          is.recent.unshift({ kind: pr.kind, prId: pr.prId });
          if (t - st.at > WALK) { carrying = false; phase = "returning"; from = I.center; toKey = "factory"; start = st.at + WALK; }
          if (t - st.at > WALK * 2) done = true;
          break;
        }
        case "pr_closed":
          phase = "scrapping"; carrying = false;
          if (t - st.at < WALK * 1.5) scraps.push({ ...cur, k: (t - st.at) / (WALK * 1.5) });
          toKey = "factory"; start = st.at + WALK * 0.5;
          if (t - st.at > WALK * 2.5) done = true;
          break;
      }
    }
    if (done) continue;
    if ((phase === "carrying" || phase === "stamped") && t - start >= WALK) {
      if (phase === "carrying") phase = "queued";
      if (!queues.has(pr.repo)) queues.set(pr.repo, []);
      queues.get(pr.repo)!.push({ prId: pr.prId, since: readyAt });
    }
    pending.push({ pr, from, toKey: `${toKey}`, start, phase, stamped, carrying });
  }
  for (const [repo, q] of queues) { q.sort((a, b) => a.since - b.since || a.prId.localeCompare(b.prId)); islandState.get(repo)!.queue = q.length; }

  const workers: WorkerState[] = pending.map((p) => {
    const I = isle.get(p.pr.repo)!;
    let target: Pt;
    let slot = -1;
    if (p.toKey === "station") target = stationPos(p.pr.station);
    else if (p.toKey === "island") target = I.center;
    else if (p.toKey === "factory") target = FACTORY;
    else {
      const q = queues.get(p.pr.repo) ?? [];
      slot = Math.max(0, q.findIndex((x) => x.prId === p.pr.prId));
      const dx = (FACTORY.x - I.dock.x), dy = (FACTORY.y - I.dock.y);
      const len = Math.hypot(dx, dy) || 1;
      target = { x: I.dock.x + (dx / len) * slot * 7, y: I.dock.y + (dy / len) * slot * 7 };
    }
    return {
      prId: p.pr.prId, repo: p.pr.repo, slot, actor: p.pr.actor, isBot: bots.has(p.pr.actor), kind: p.pr.kind,
      pos: lerp(p.from, target, (t - p.start) / WALK), phase: p.phase, carrying: p.carrying,
      stamped: p.stamped, progress: Math.max(0, Math.min(1, (t - p.start) / WALK)),
    };
  });
  workers.forEach((w) => (w.pos = { x: Math.round(w.pos.x), y: Math.round(w.pos.y) }));
  for (const is of islandState.values()) is.recent = is.recent.slice(0, 6);
  return {
    t, realMs: playToReal(c.tl, t),
    workers: workers.slice(0, MAX_WORKERS), hidden: Math.max(0, workers.length - MAX_WORKERS),
    islands: [...islandState.values()], inspectors, scraps, creatures: creaturesAt(c, t),
  };
}

export const EVENT_LABEL: Record<ActivityEvent["type"], string> = {
  pr_opened: "started fabricating",
  pr_ready_for_review: "queued at the dock with",
  review_changes_requested: "sent back for rework",
  review_approved: "stamped",
  pr_merged: "delivered",
  pr_closed: "scrapped",
};

/** 0 = full daylight, 1 = deep night, from the replay's real UTC time. Weekends never get fully bright. */
export function nightAt(realMs: number) {
  const d = new Date(realMs);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  let n = h < 5 ? 1 : h < 8 ? 1 - (h - 5) / 3 : h < 18 ? 0 : h < 22 ? (h - 18) / 4 : 1;
  const day = d.getUTCDay();
  if (day === 0 || day === 6) n = Math.max(n, 0.25);
  return n * n * (3 - 2 * n);
}
