import type { ActivityEvent, Issue, IssueKind, ItemKind, Snapshot } from "./types";

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Opts = { seed: number; weekStart: string; prs: number; closeP: number; openP: number; weekdayP: number; boost?: number };

/** Deterministic generated week for Mantequilla-Soft. */
export function makeWeek(o: Opts): Snapshot {
  const r = rng(o.seed);
  const weekStart = Date.parse(o.weekStart);
  const H = 3600_000;
  const repos = [
    { id: "snapie-io", name: "snapie-io", anonymized: false, mergedTotal: 42 + (o.boost ?? 0) },
    { id: "butter-factory", name: "butter-factory", anonymized: false, mergedTotal: 3 },
    { id: "hive-wallet", name: "hive-wallet", anonymized: false, mergedTotal: 18 },
    { id: "snapie-games", name: "snapie-games", anonymized: false, mergedTotal: 27 },
    { id: "docs-site", name: "docs-site", anonymized: false, mergedTotal: 9 },
    { id: "r7", name: "Mystery Island", anonymized: true, mergedTotal: 12 },
  ];
  const humans = ["andresmena", "mariaq", "kofi-dev", "lin-wei", "tomasz", "sofiaruiz", "ravi-k"];
  const people = [
    ...humans.map((id) => ({ id, displayName: id, isBot: false })),
    { id: "dependabot[bot]", displayName: "dependabot", isBot: true },
  ];
  const kinds: ItemKind[] = ["gear", "gear", "bolt", "bolt", "spring", "scroll", "nut", "gauge"];
  const events: ActivityEvent[] = [];
  const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)]!;
  // working-hours biased timestamp
  const workTime = () => {
    const day = r() < o.weekdayP ? Math.floor(r() * 5) : 5 + Math.floor(r() * 2);
    const hour = r() < 0.85 ? 9 + r() * 10 : r() * 24;
    return weekStart + day * 24 * H + hour * H;
  };
  const counters: Record<string, number> = {};
  for (let i = 0; i < o.prs; i++) {
    const repo = pick(repos);
    const bot = r() < 0.12;
    const actor = bot ? "dependabot[bot]" : pick(humans);
    const itemKind: ItemKind = bot ? "crate" : pick(kinds);
    counters[repo.id] = (counters[repo.id] ?? 100 + Math.floor(r() * 200)) + 1;
    const prId = `${repo.id}#${counters[repo.id]}`;
    let t = workTime();
    const prUrl = repo.anonymized ? undefined : `https://github.com/Mantequilla-Soft/${repo.name}/pull/${counters[repo.id]}`;
    const sha = Array.from({ length: 7 }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
    const push = (type: ActivityEvent["type"], who = actor) => {
      if (t < weekStart + 7 * 24 * H - 1000)
        events.push({
          at: new Date(t).toISOString(), prId, repo: repo.id, actor: who, type, itemKind,
          ...(prUrl ? { prUrl } : {}), ...(type === "pr_merged" && !repo.anonymized ? { commitSha: sha } : {}),
        });
    };
    const reviewer = () => pick(humans.filter((h) => h !== actor));
    push("pr_opened");
    t += (0.5 + r() * 8) * H;
    push("pr_ready_for_review");
    if (r() < 0.25) {
      t += (0.5 + r() * 5) * H;
      push("review_changes_requested", reviewer());
      t += (1 + r() * 6) * H;
      push("pr_ready_for_review");
    }
    const fate = r();
    if (fate < o.closeP) {
      t += (1 + r() * 10) * H;
      push("pr_closed");
      continue;
    }
    if (fate < o.closeP + o.openP) continue; // still open at week end
    t += (0.3 + r() * 6) * H;
    push("review_approved", reviewer());
    t += (0.1 + r() * 3) * H;
    push("pr_merged");
  }
  // issues: bugs, enhancement boats and plain task boats
  const issues: Issue[] = [];
  const nIssues = Math.round(o.prs * 0.4) + 3;
  const ikinds: IssueKind[] = ["bug", "bug", "enhancement", "task", "task"];
  const LABELS: Record<IssueKind, string[]> = {
    bug: ["bug", "crash", "ui", "backend", "p1", "regression"],
    enhancement: ["enhancement", "feature", "ux", "api", "nice-to-have"],
    task: ["docs", "chore", "good first issue", "infra", "question"],
  };
  const extras = (kind: IssueKind, anonymized: boolean) => {
    const pool = LABELS[kind];
    const labels = anonymized ? [] : [...new Set([pool[0]!, ...(r() < 0.7 ? [pick(pool)] : []), ...(r() < 0.3 ? [pick(pool)] : [])])].filter((l) => !(kind === "task" && l === pool[0] && r() < 0.5));
    return { ...(labels.length ? { labels } : {}), ...(r() < 0.5 ? { assignee: pick(humans) } : {}) };
  };
  for (let i = 0; i < nIssues; i++) {
    const repo = pick(repos);
    const actor = pick(humans);
    const kind = pick(ikinds);
    counters[repo.id] = (counters[repo.id] ?? 100 + Math.floor(r() * 200)) + 1;
    const n = counters[repo.id]!;
    const opened = workTime();
    const closes = r() < 0.55;
    const closedAt = opened + (1 + r() * 40) * H;
    issues.push({
      id: `${repo.id}!${n}`, repo: repo.id, actor, kind, openedAt: new Date(opened).toISOString(),
      ...(closes && closedAt < weekStart + 7 * 24 * H - 1000 ? { closedAt: new Date(closedAt).toISOString(), closedBy: pick(humans) } : {}),
      ...(repo.anonymized ? {} : { url: `https://github.com/Mantequilla-Soft/${repo.name}/issues/${n}` }),
      ...extras(kind, repo.anonymized),
    });
  }
  // backlog: issues opened before the week and still open — busy waters
  const nBacklog = Math.round(nIssues * 0.6) + 2;
  for (let i = 0; i < nBacklog; i++) {
    const repo = pick(repos);
    counters[repo.id] = (counters[repo.id] ?? 100 + Math.floor(r() * 200)) + 1;
    const n = counters[repo.id]!;
    const opened = weekStart - (2 + r() * 20) * 24 * H; // 2–22 days before the week
    const kind = pick(ikinds);
    issues.push({
      id: `${repo.id}!${n}`, repo: repo.id, actor: pick(humans), kind, openedAt: new Date(opened).toISOString(),
      ...(repo.anonymized ? {} : { url: `https://github.com/Mantequilla-Soft/${repo.name}/issues/${n}` }),
      ...extras(kind, repo.anonymized),
    });
  }
  issues.sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id));
  events.sort((a, b) => a.at.localeCompare(b.at) || a.prId.localeCompare(b.prId));
  return {
    schemaVersion: 1,
    org: "Mantequilla-Soft",
    weekStart: new Date(weekStart).toISOString(),
    weekEnd: new Date(weekStart + 7 * 24 * H).toISOString(),
    generatedAt: "2026-10-05T00:10:00.000Z",
    repos,
    people,
    events,
    issues,
  };
}

export const FIXTURES = [
  { id: "sample", label: "Sample week · 28 Sep 2026", make: () => makeWeek({ seed: 158, weekStart: "2026-09-28T00:00:00Z", prs: 46, closeP: 0.1, openP: 0.1, weekdayP: 0.88 }) },
  { id: "holiday", label: "Quiet holiday week · 21 Dec 2026", make: () => makeWeek({ seed: 2412, weekStart: "2026-12-21T00:00:00Z", prs: 11, closeP: 0.1, openP: 0.35, weekdayP: 0.55, boost: 20 }) },
  { id: "crunch", label: "Crunch release week · 21 Sep 2026", make: () => makeWeek({ seed: 777, weekStart: "2026-09-21T00:00:00Z", prs: 110, closeP: 0.05, openP: 0.04, weekdayP: 0.8 }) },
] as const;

export const sampleWeek = FIXTURES[0].make;
