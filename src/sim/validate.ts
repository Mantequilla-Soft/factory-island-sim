import type { Snapshot } from "./types";

const TYPES = ["pr_opened", "pr_ready_for_review", "review_changes_requested", "review_approved", "pr_merged", "pr_closed"];
const KINDS = ["gear", "bolt", "spring", "scroll", "nut", "gauge", "crate"];

/** Validates a parsed JSON value against the schemaVersion 1 snapshot contract. Throws a readable error. */
export function validateSnapshot(v: unknown): Snapshot {
  const fail = (m: string): never => { throw new Error(m); };
  if (!v || typeof v !== "object") fail("Snapshot must be a JSON object.");
  const s = v as Record<string, unknown>;
  if (s.schemaVersion !== 1) fail(`Unsupported schemaVersion: ${String(s.schemaVersion)} (expected 1).`);
  for (const k of ["org", "weekStart", "weekEnd"]) if (typeof s[k] !== "string") fail(`Missing "${k}".`);
  if (isNaN(Date.parse(s.weekStart as string)) || isNaN(Date.parse(s.weekEnd as string))) fail("weekStart/weekEnd must be ISO dates.");
  if (Date.parse(s.weekEnd as string) <= Date.parse(s.weekStart as string)) fail("weekEnd must be after weekStart.");
  if (!Array.isArray(s.repos) || s.repos.length === 0) fail("repos must be a non-empty array.");
  if (!Array.isArray(s.people)) fail("people must be an array.");
  if (!Array.isArray(s.events)) fail("events must be an array.");
  const repos = s.repos as Record<string, unknown>[];
  if (repos.length > 12) fail("At most 12 repos are supported per snapshot.");
  const repoIds = new Set<string>();
  repos.forEach((r, i) => {
    if (typeof r.id !== "string" || typeof r.name !== "string") fail(`repos[${i}] needs id and name.`);
    repoIds.add(r.id as string);
  });
  const people = s.people as Record<string, unknown>[];
  const ids = new Set<string>();
  people.forEach((p, i) => { if (typeof p.id !== "string") fail(`people[${i}] needs id.`); ids.add(p.id as string); });
  (s.events as Record<string, unknown>[]).forEach((e, i) => {
    if (typeof e.at !== "string" || isNaN(Date.parse(e.at))) fail(`events[${i}].at is not an ISO timestamp.`);
    if (!TYPES.includes(e.type as string)) fail(`events[${i}].type "${String(e.type)}" is unknown.`);
    if (!KINDS.includes(e.itemKind as string)) fail(`events[${i}].itemKind "${String(e.itemKind)}" is unknown.`);
    if (!repoIds.has(e.repo as string)) fail(`events[${i}].repo "${String(e.repo)}" is not in repos.`);
    if (typeof e.prId !== "string") fail(`events[${i}].prId missing.`);
    if (!ids.has(e.actor as string)) fail(`events[${i}].actor "${String(e.actor)}" is not in people.`);
  });
  const snap = {
    ...(s as unknown as Snapshot),
    repos: repos.map((r) => ({ anonymized: false, mergedTotal: 0, ...r })) as Snapshot["repos"],
    people: people.map((p) => ({ isBot: false, ...p })) as Snapshot["people"],
    events: [...(s.events as Snapshot["events"])].sort((a, b) => a.at.localeCompare(b.at) || a.prId.localeCompare(b.prId)),
  };
  return snap;
}
