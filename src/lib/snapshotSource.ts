import { validateSnapshot } from "@/sim/validate";
import type { Snapshot } from "@/sim/types";

/**
 * Where a snapshot comes from at runtime.
 *
 * Either one full snapshot file (`snapshot`), or an org's snapshot folder
 * (`base` + `org`) where `week` is an ISO week like `2026-W40` or `latest`.
 * The folder layout is the one `scripts/collector.ts` writes:
 *   <base>/<org>/index.json   -> { latest, weeks[] }
 *   <base>/<org>/<week>.json  -> a schemaVersion 1 snapshot
 */
export type SourceParams = {
  snapshot?: string | undefined;
  org?: string | undefined;
  week?: string | undefined;
};

export type SourceConfig = {
  /** Folder that holds one sub-folder per org. */
  base: string;
  org: string;
  /** Hosts a `snapshot` URL from the page address may point at. */
  allowedHosts: string[];
  /** The page's own origin, always allowed (e.g. a snapshot published next to the app). */
  selfOrigin?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  signal?: AbortSignal | undefined;
};

export type LoadedSnapshot = { snapshot: Snapshot; url: string; label: string };

/** A snapshot is a few hundred KB at most. Refuse anything near this so a bad URL cannot hang the tab. */
export const MAX_SNAPSHOT_BYTES = 5_000_000;
export const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const ORG_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export class SnapshotSourceError extends Error {}

/** True when `raw` is an https URL on an allowed host, or on the page's own origin. */
export function isAllowedSnapshotUrl(
  raw: string,
  allowedHosts: string[],
  selfOrigin?: string,
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (selfOrigin && url.origin === selfOrigin) return true;
  if (url.protocol !== "https:") return false;
  return allowedHosts.some((h) => h.toLowerCase() === url.hostname.toLowerCase());
}

export function isWeek(v: string): boolean {
  return v === "latest" || WEEK_RE.test(v);
}

/** Picks the week to load from a collector `index.json`. */
export function pickWeek(index: unknown, requested: string | undefined): string {
  const want = requested && requested !== "latest" ? requested : undefined;
  const idx = (index && typeof index === "object" ? index : {}) as {
    latest?: unknown;
    weeks?: unknown;
  };
  const weeks = Array.isArray(idx.weeks)
    ? idx.weeks.filter((w): w is string => typeof w === "string" && WEEK_RE.test(w))
    : [];
  if (want) {
    if (!WEEK_RE.test(want))
      throw new SnapshotSourceError(`"${want}" is not a week like 2026-W40.`);
    if (weeks.length && !weeks.includes(want))
      throw new SnapshotSourceError(`No snapshot for ${want} yet.`);
    return want;
  }
  const latest =
    typeof idx.latest === "string" && WEEK_RE.test(idx.latest)
      ? idx.latest
      : [...weeks].sort().at(-1);
  if (!latest) throw new SnapshotSourceError("No snapshots have been published yet.");
  return latest;
}

async function fetchJson(url: string, cfg: SourceConfig, what: string): Promise<unknown> {
  const doFetch = cfg.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(
      url,
      cfg.signal ? { signal: cfg.signal, redirect: "follow" } : { redirect: "follow" },
    );
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new SnapshotSourceError(`Couldn't reach the ${what}.`);
  }
  if (res.status === 404) throw new SnapshotSourceError(`The ${what} was not found.`);
  if (!res.ok) throw new SnapshotSourceError(`The ${what} request failed (${res.status}).`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SNAPSHOT_BYTES)
    throw new SnapshotSourceError(`The ${what} is too large.`);
  const text = await res.text();
  if (text.length > MAX_SNAPSHOT_BYTES) throw new SnapshotSourceError(`The ${what} is too large.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new SnapshotSourceError(`The ${what} isn't valid JSON.`);
  }
}

function folderUrl(base: string, org: string): string {
  return `${base.replace(/\/+$/, "")}/${encodeURIComponent(org)}`;
}

/**
 * Loads and validates a snapshot.
 *
 * `trusted` skips the host allowlist for sources that come from the build
 * (env vars) instead of the page address. Anything taken from the page URL
 * must stay untrusted, because a crafted link could otherwise make the app
 * render data from any server.
 */
export async function loadSnapshot(
  params: SourceParams,
  cfg: SourceConfig,
  opts: { trusted?: boolean } = {},
): Promise<LoadedSnapshot> {
  if (params.snapshot) {
    if (!opts.trusted && !isAllowedSnapshotUrl(params.snapshot, cfg.allowedHosts, cfg.selfOrigin)) {
      throw new SnapshotSourceError("That snapshot address is not on an allowed host.");
    }
    const snapshot = validateSnapshotSafe(await fetchJson(params.snapshot, cfg, "snapshot"));
    return {
      snapshot,
      url: params.snapshot,
      label: params.snapshot.split("/").pop() || "snapshot",
    };
  }

  const org = params.org ?? cfg.org;
  if (!ORG_RE.test(org)) throw new SnapshotSourceError("That org name isn't valid.");
  const week = params.week ?? "latest";
  if (!isWeek(week)) throw new SnapshotSourceError(`"${week}" is not a week like 2026-W40.`);

  const folder = folderUrl(cfg.base, org);
  const picked =
    week === "latest"
      ? pickWeek(await fetchJson(`${folder}/index.json`, cfg, "snapshot index"), undefined)
      : week;
  const url = `${folder}/${picked}.json`;
  const snapshot = validateSnapshotSafe(await fetchJson(url, cfg, "snapshot"));
  return { snapshot, url, label: `${org} ${picked}` };
}

function validateSnapshotSafe(v: unknown): Snapshot {
  try {
    return validateSnapshot(v);
  } catch (e) {
    throw new SnapshotSourceError(`The snapshot isn't valid: ${(e as Error).message}`);
  }
}
