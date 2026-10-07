import type { ActivityEvent, ItemKind, Snapshot } from "./types";

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
};

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
  return { snapshot: s, tl, islands: layoutIslands(s), prs, feed };
}

/* ---------- pure world state ---------- */
export type WorkerPhase = "fabricating" | "carrying" | "queued" | "stamped" | "delivering" | "returning" | "scrapping" | "rework";
export type WorkerState = { prId: string; actor: string; isBot: boolean; kind: ItemKind; pos: Pt; phase: WorkerPhase; carrying: boolean; stamped: boolean; progress: number };
export type IslandState = { id: string; buildings: number; mergedThisWeek: number; recent: { kind: ItemKind; prId: string }[]; queue: number };
export type WorldState = { t: number; realMs: number; workers: WorkerState[]; islands: IslandState[]; inspectors: Pt[]; scraps: Pt[]; hidden: number };

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
  const inspectors: Pt[] = [];
  const scraps: Pt[] = [];

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
          if (t - st.at < WALK * 1.5) inspectors.push({ x: I.dock.x + 6, y: I.dock.y - 6 });
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
          if (t - st.at < WALK * 1.5) scraps.push({ ...cur });
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
    if (p.toKey === "station") target = stationPos(p.pr.station);
    else if (p.toKey === "island") target = I.center;
    else if (p.toKey === "factory") target = FACTORY;
    else {
      const q = queues.get(p.pr.repo) ?? [];
      const slot = Math.max(0, q.findIndex((x) => x.prId === p.pr.prId));
      const dx = (FACTORY.x - I.dock.x), dy = (FACTORY.y - I.dock.y);
      const len = Math.hypot(dx, dy) || 1;
      target = { x: I.dock.x + (dx / len) * slot * 7, y: I.dock.y + (dy / len) * slot * 7 };
    }
    return {
      prId: p.pr.prId, actor: p.pr.actor, isBot: bots.has(p.pr.actor), kind: p.pr.kind,
      pos: lerp(p.from, target, (t - p.start) / WALK), phase: p.phase, carrying: p.carrying,
      stamped: p.stamped, progress: Math.max(0, Math.min(1, (t - p.start) / WALK)),
    };
  });
  workers.forEach((w) => (w.pos = { x: Math.round(w.pos.x), y: Math.round(w.pos.y) }));
  for (const is of islandState.values()) is.recent = is.recent.slice(0, 6);
  return {
    t, realMs: playToReal(c.tl, t),
    workers: workers.slice(0, MAX_WORKERS), hidden: Math.max(0, workers.length - MAX_WORKERS),
    islands: [...islandState.values()], inspectors, scraps,
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
