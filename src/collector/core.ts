/**
 * Butter Factory collector core: GitHub REST -> schemaVersion 1 snapshot.
 * Shared by the in-app collector (browser) and scripts/collector.ts (Node / GitHub Actions).
 * Relative imports only so it runs outside the Vite alias setup.
 * Privacy: titles are read only to derive itemKind and are never stored; bodies and branch names are never read.
 */
import type { ActivityEvent, ItemKind, Person, RepoInfo, Snapshot } from "../sim/types";
import { validateSnapshot } from "../sim/validate";

export type PrivateRepoMode = "anonymize" | "exclude" | "include";
export type CollectOptions = {
  org: string;
  week: string; // ISO week, e.g. 2026-W40
  token?: string | undefined;
  privateRepos?: PrivateRepoMode;
  maxPrs?: number;
  onProgress?: (msg: string) => void;
  fetchImpl?: typeof fetch;
};
export type CollectResult = { snapshot: Snapshot; stats: { requests: number; repos: number; prs: number; truncated: boolean } };

type GhUser = { login: string; avatar_url?: string; type?: string };
type GhRepo = { name: string; private: boolean; archived?: boolean };
type GhPull = { number: number; title: string; user: GhUser | null; created_at: string; updated_at: string; closed_at: string | null; merged_at: string | null; draft?: boolean };
type GhReview = { user: GhUser | null; state: string; submitted_at?: string };
type GhTimeline = { event?: string; created_at?: string };

/* ---------- ISO week helpers ---------- */
export function isoWeekStart(week: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(week.trim());
  if (!m) throw new Error(`Week must look like 2026-W40 (got "${week}").`);
  const year = Number(m[1]), w = Number(m[2]);
  if (w < 1 || w > 53) throw new Error("Week number must be between 1 and 53.");
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000);
  return new Date(monday.getTime() + (w - 1) * 7 * 86400000);
}
export function isoWeekOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}
export const lastCompleteWeek = (now = new Date()) => isoWeekOf(new Date(now.getTime() - 7 * 86400000));

/* ---------- itemKind ---------- */
export function itemKindFor(title: string, isBot: boolean): ItemKind {
  if (isBot) return "crate";
  const m = /^\s*\[?([a-z]+)\]?(\([^)]*\))?!?\s*:/i.exec(title);
  switch (m?.[1]?.toLowerCase()) {
    case "feat": case "feature": return "gear";
    case "fix": case "bugfix": case "hotfix": return "bolt";
    case "perf": return "spring";
    case "docs": case "doc": return "scroll";
    case "test": case "tests": return "gauge";
    default: return "nut"; // chore, refactor, ci, build, style, no prefix
  }
}
const isBotUser = (u: GhUser | null) => !!u && (u.type === "Bot" || u.login.endsWith("[bot]"));

/* ---------- collector ---------- */
export async function collect(o: CollectOptions): Promise<CollectResult> {
  const f = o.fetchImpl ?? fetch;
  const log = o.onProgress ?? (() => {});
  const mode = o.privateRepos ?? "anonymize";
  const maxPrs = o.maxPrs ?? 250;
  const org = o.org.trim();
  if (!/^[A-Za-z0-9-]{1,39}$/.test(org)) throw new Error("That doesn't look like a GitHub org or user name.");
  const start = isoWeekStart(o.week), end = new Date(start.getTime() + 7 * 86400000);
  const inWeek = (iso: string | null | undefined) => !!iso && iso >= start.toISOString() && iso < end.toISOString();
  let requests = 0;

  async function gh<T>(path: string): Promise<{ data: T; next: string | null }> {
    requests++;
    const res = await f(path.startsWith("http") ? path : `https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0")
        throw new Error(`GitHub rate limit reached${o.token ? "" : " — add a token for 5,000 requests/hour"}.`);
      if (res.status === 401) throw new Error("GitHub rejected the token (401). Check it is valid and not expired.");
      const err = new Error(`GitHub ${res.status} on ${path.replace("https://api.github.com", "")}: ${body.slice(0, 160)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    const link = res.headers.get("link") ?? "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
    return { data: (await res.json()) as T, next };
  }
  async function all<T>(path: string, stop?: (page: T[]) => boolean): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = path;
    while (url) {
      const r: { data: T[]; next: string | null } = await gh<T[]>(url);
      out.push(...r.data);
      if (stop?.(r.data)) break;
      url = r.next;
    }
    return out;
  }
  async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
    const res: R[] = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; res[k] = await fn(items[k]!); }
    }));
    return res;
  }

  log(`Listing repositories for ${org}…`);
  let repos: GhRepo[];
  try { repos = await all<GhRepo>(`/orgs/${org}/repos?type=all&per_page=100`); }
  catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
    repos = await all<GhRepo>(`/users/${org}/repos?type=owner&per_page=100`);
  }
  repos = repos.filter((r) => !r.archived && (mode !== "exclude" || !r.private)).slice(0, 80);
  if (!repos.length) throw new Error(`No accessible repositories found for ${org}.`);
  log(`Found ${repos.length} repositories. Scanning pull requests for ${o.week}…`);

  const startIso = start.toISOString();
  const perRepo = await pool(repos, 4, async (repo) => {
    const pulls = await all<GhPull>(`/repos/${org}/${repo.name}/pulls?state=all&sort=updated&direction=desc&per_page=100`,
      (page) => page.length > 0 && page[page.length - 1]!.updated_at < startIso);
    return { repo, pulls: pulls.filter((p) => p.updated_at >= startIso && p.created_at < end.toISOString()) };
  });
  let candidates = perRepo.flatMap(({ repo, pulls }) => pulls.map((pr) => ({ repo, pr })));
  const truncated = candidates.length > maxPrs;
  candidates = candidates.slice(0, maxPrs);
  log(`Reading reviews${o.token ? " and timelines" : ""} for ${candidates.length} pull requests…`);

  const people = new Map<string, Person>();
  const addPerson = (u: GhUser | null) => {
    if (!u) return "ghost";
    if (!people.has(u.login)) people.set(u.login, { id: u.login, displayName: u.login.replace(/\[bot\]$/, ""), ...(u.avatar_url ? { avatarUrl: u.avatar_url } : {}), isBot: isBotUser(u) });
    return u.login;
  };
  type Raw = Omit<ActivityEvent, "repo" | "prId"> & { repoName: string; number: number };
  let done = 0;
  const rawEvents = (await pool(candidates, 4, async ({ repo, pr }) => {
    const base = `/repos/${org}/${repo.name}`;
    const reviews = await all<GhReview>(`${base}/pulls/${pr.number}/reviews?per_page=100`);
    let readyAt: string | null = null;
    if (o.token) {
      const tl = await all<GhTimeline>(`/repos/${org}/${repo.name}/issues/${pr.number}/timeline?per_page=100`);
      readyAt = tl.find((e) => e.event === "ready_for_review")?.created_at
        ?? tl.find((e) => e.event === "review_requested")?.created_at ?? null;
    }
    if (++done % 20 === 0) log(`  …${done}/${candidates.length}`);
    const author = addPerson(pr.user);
    const kind = itemKindFor(pr.title, isBotUser(pr.user)); // title discarded after this line
    const firstReview = reviews.map((r) => r.submitted_at).filter((x): x is string => !!x).sort()[0];
    if (!readyAt && !pr.draft) readyAt = new Date(Date.parse(pr.created_at) + 60_000).toISOString();
    if (!readyAt && (firstReview || pr.merged_at)) readyAt = firstReview ?? pr.merged_at;
    if (readyAt && firstReview && readyAt > firstReview) readyAt = new Date(Date.parse(firstReview) - 60_000).toISOString();
    const ev: Raw[] = [];
    const push = (at: string | null | undefined, type: ActivityEvent["type"], actor: string) => {
      if (inWeek(at)) ev.push({ at: at!, type, actor, itemKind: kind, repoName: repo.name, number: pr.number });
    };
    push(pr.created_at, "pr_opened", author);
    push(readyAt, "pr_ready_for_review", author);
    for (const r of reviews) {
      if (r.state === "APPROVED") push(r.submitted_at, "review_approved", addPerson(r.user));
      else if (r.state === "CHANGES_REQUESTED") push(r.submitted_at, "review_changes_requested", addPerson(r.user));
    }
    if (pr.merged_at) push(pr.merged_at, "pr_merged", author);
    else if (pr.closed_at) push(pr.closed_at, "pr_closed", author);
    return ev;
  })).flat();

  // choose up to 12 islands (most active first; idle repos fill an empty world)
  const activity = new Map<string, number>();
  rawEvents.forEach((e) => activity.set(e.repoName, (activity.get(e.repoName) ?? 0) + 1));
  const chosen = [...repos].sort((a, b) => (activity.get(b.name) ?? 0) - (activity.get(a.name) ?? 0) || a.name.localeCompare(b.name))
    .filter((r, i) => (activity.get(r.name) ?? 0) > 0 || (activity.size === 0 && i < 6)).slice(0, 12);

  let anon = 0;
  const repoInfo = new Map<string, RepoInfo>();
  for (const r of chosen) {
    const hide = r.private && mode === "anonymize";
    let mergedTotal = 0;
    if (o.token) {
      try {
        const q = encodeURIComponent(`repo:${org}/${r.name} is:pr is:merged merged:<${startIso.slice(0, 10)}`);
        mergedTotal = (await gh<{ total_count: number }>(`/search/issues?q=${q}&per_page=1`)).data.total_count;
      } catch { mergedTotal = 0; }
    }
    repoInfo.set(r.name, { id: hide ? `island-${++anon}` : r.name, name: hide ? "Mystery Island" : r.name, anonymized: hide, mergedTotal });
  }
  const prIds = new Map<string, string>();
  const anonCounters = new Map<string, number>();
  const events: ActivityEvent[] = rawEvents.filter((e) => repoInfo.has(e.repoName)).map((e) => {
    const info = repoInfo.get(e.repoName)!;
    const key = `${e.repoName}#${e.number}`;
    if (!prIds.has(key)) {
      const n = info.anonymized ? (anonCounters.set(info.id, (anonCounters.get(info.id) ?? 0) + 1), anonCounters.get(info.id)!) : e.number;
      prIds.set(key, `${info.id}#${n}`);
    }
    return { at: e.at, prId: prIds.get(key)!, repo: info.id, actor: e.actor, type: e.type, itemKind: e.itemKind };
  });
  if (!people.has("ghost") && events.some((e) => e.actor === "ghost")) people.set("ghost", { id: "ghost", displayName: "ghost", isBot: false });
  const used = new Set(events.map((e) => e.actor));

  const snapshot = validateSnapshot({
    schemaVersion: 1,
    org,
    weekStart: startIso,
    weekEnd: end.toISOString(),
    generatedAt: new Date().toISOString(),
    repos: [...repoInfo.values()],
    people: [...people.values()].filter((p) => used.has(p.id)),
    events,
  });
  log(`Done: ${events.length} events across ${repoInfo.size} islands (${requests} API requests).`);
  return { snapshot, stats: { requests, repos: repoInfo.size, prs: prIds.size, truncated } };
}
