import type { Snapshot } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type L = any;
const TYPES = ["pr_opened", "pr_ready_for_review", "review_changes_requested", "review_approved", "pr_merged", "pr_closed"];
const KINDS = ["gear", "bolt", "spring", "scroll", "nut", "gauge", "crate"];

/** Validates a parsed JSON value against the schemaVersion 1 snapshot contract. Throws a readable error. */
export function validateSnapshot(v: unknown): Snapshot {
  const fail = (m: string): never => { throw new Error(m); };
  if (!v || typeof v !== "object") fail("Snapshot must be a JSON object.");
  const s = v as L;
  if (s.schemaVersion !== 1) fail(`Unsupported schemaVersion: ${String(s.schemaVersion)} (expected 1).`);
  for (const k of ["org", "weekStart", "weekEnd"]) if (typeof s[k] !== "string") fail(`Missing "${k}".`);
  if (isNaN(Date.parse(s.weekStart as string)) || isNaN(Date.parse(s.weekEnd as string))) fail("weekStart/weekEnd must be ISO dates.");
  if (Date.parse(s.weekEnd as string) <= Date.parse(s.weekStart as string)) fail("weekEnd must be after weekStart.");
  if (!Array.isArray(s.repos) || s.repos.length === 0) fail("repos must be a non-empty array.");
  if (!Array.isArray(s.people)) fail("people must be an array.");
  if (!Array.isArray(s.events)) fail("events must be an array.");
  const repos = s.repos as L[];
  if (repos.length > 12) fail("At most 12 repos are supported per snapshot.");
  const repoIds = new Set<string>();
  repos.forEach((r, i) => {
    if (typeof r.id !== "string" || typeof r.name !== "string") fail(`repos[${i}] needs id and name.`);
    repoIds.add(r.id as string);
  });
  const people = s.people as L[];
  const ids = new Set<string>();
  people.forEach((p, i) => {
    if (typeof p.id !== "string") fail(`people[${i}] needs id.`);
    ids.add(p.id as string);
    // The page loads this image in every viewer's browser, so an arbitrary host would leak their IP.
    if (p.avatarUrl !== undefined && (typeof p.avatarUrl !== "string" || !/^https:\/\/(avatars\.githubusercontent\.com|github\.com)\//.test(p.avatarUrl))) fail(`people[${i}].avatarUrl must be a https://avatars.githubusercontent.com or https://github.com link.`);
  });
  (s.events as L[]).forEach((e, i) => {
    if (typeof e.at !== "string" || isNaN(Date.parse(e.at))) fail(`events[${i}].at is not an ISO timestamp.`);
    if (!TYPES.includes(e.type as string)) fail(`events[${i}].type "${String(e.type)}" is unknown.`);
    if (!KINDS.includes(e.itemKind as string)) fail(`events[${i}].itemKind "${String(e.itemKind)}" is unknown.`);
    if (!repoIds.has(e.repo as string)) fail(`events[${i}].repo "${String(e.repo)}" is not in repos.`);
    if (typeof e.prId !== "string") fail(`events[${i}].prId missing.`);
    if (!ids.has(e.actor as string)) fail(`events[${i}].actor "${String(e.actor)}" is not in people.`);
    if (e.prUrl !== undefined && (typeof e.prUrl !== "string" || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(e.prUrl))) fail(`events[${i}].prUrl must be a https://github.com/<org>/<repo>/pull/<n> link.`);
    if (e.commitSha !== undefined && (typeof e.commitSha !== "string" || !/^[0-9a-f]{7,40}$/.test(e.commitSha))) fail(`events[${i}].commitSha must be a hex commit hash.`);
  });
  if (s.issues !== undefined && !Array.isArray(s.issues)) fail("issues must be an array.");
  ((s.issues ?? []) as L[]).forEach((x, i) => {
    if (typeof x.id !== "string") fail(`issues[${i}].id missing.`);
    if (!["bug", "enhancement", "task"].includes(x.kind as string)) fail(`issues[${i}].kind "${String(x.kind)}" is unknown.`);
    if (!repoIds.has(x.repo as string)) fail(`issues[${i}].repo "${String(x.repo)}" is not in repos.`);
    if (!ids.has(x.actor as string)) fail(`issues[${i}].actor "${String(x.actor)}" is not in people.`);
    if (x.closedBy !== undefined && !ids.has(x.closedBy as string)) fail(`issues[${i}].closedBy "${String(x.closedBy)}" is not in people.`);
    if (typeof x.openedAt !== "string" || isNaN(Date.parse(x.openedAt))) fail(`issues[${i}].openedAt is not an ISO timestamp.`);
    if (x.closedAt !== undefined && (typeof x.closedAt !== "string" || isNaN(Date.parse(x.closedAt)))) fail(`issues[${i}].closedAt is not an ISO timestamp.`);
    if (x.labels !== undefined && (!Array.isArray(x.labels) || x.labels.length > 6 || x.labels.some((l) => typeof l !== "string" || l.length > 40))) fail(`issues[${i}].labels must be up to 6 short label names.`);
    if (x.assignee !== undefined && !ids.has(x.assignee as string)) fail(`issues[${i}].assignee "${String(x.assignee)}" is not in people.`);
    if (x.url !== undefined && (typeof x.url !== "string" || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(x.url))) fail(`issues[${i}].url must be a https://github.com/<org>/<repo>/issues/<n> link.`);
  });
  const snap = {
    ...(s as unknown as Snapshot),
    repos: repos.map((r) => ({ anonymized: false, mergedTotal: 0, ...r })) as Snapshot["repos"],
    people: people.map((p) => ({ isBot: false, ...p })) as Snapshot["people"],
    ...(s.issues ? { issues: [...(s.issues as NonNullable<Snapshot["issues"]>)].sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id)) } : {}),
    events: [...(s.events as Snapshot["events"])].sort((a, b) => a.at.localeCompare(b.at) || a.prId.localeCompare(b.prId)),
  };
  return snap;
}
