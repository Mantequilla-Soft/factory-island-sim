import { describe, expect, it, vi } from "vitest";
import { FIXTURES } from "@/sim/fixture";
import {
  MAX_SNAPSHOT_BYTES,
  SnapshotSourceError,
  isAllowedSnapshotUrl,
  loadSnapshot,
  pickWeek,
} from "@/lib/snapshotSource";

const BASE = "https://raw.githubusercontent.com/Mantequilla-Soft/factory-island-sim/data/snapshots";
const HOSTS = ["raw.githubusercontent.com", "cdn.jsdelivr.net"];
const snap = () => FIXTURES[0]!.make();

const reply = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    ...(init.headers ? { headers: init.headers } : {}),
  });

function fetchFrom(routes: Record<string, () => Response>) {
  return vi.fn(async (url: string | URL | Request) => {
    const r = routes[String(url)];
    if (!r) return new Response("nope", { status: 404 });
    return r();
  }) as unknown as typeof fetch;
}

describe("isAllowedSnapshotUrl", () => {
  it("allows https on a listed host and the page's own origin", () => {
    expect(isAllowedSnapshotUrl(`${BASE}/o/2026-W40.json`, HOSTS)).toBe(true);
    expect(
      isAllowedSnapshotUrl("https://factory.snapie.io/x.json", HOSTS, "https://factory.snapie.io"),
    ).toBe(true);
  });
  it("rejects other hosts, plain http, credentials, junk and look-alike hosts", () => {
    expect(isAllowedSnapshotUrl("https://evil.example/x.json", HOSTS)).toBe(false);
    expect(isAllowedSnapshotUrl("http://raw.githubusercontent.com/x.json", HOSTS)).toBe(false);
    expect(isAllowedSnapshotUrl("https://user:pw@raw.githubusercontent.com/x.json", HOSTS)).toBe(
      false,
    );
    expect(
      isAllowedSnapshotUrl("https://raw.githubusercontent.com.evil.example/x.json", HOSTS),
    ).toBe(false);
    expect(isAllowedSnapshotUrl("javascript:alert(1)", HOSTS)).toBe(false);
    expect(isAllowedSnapshotUrl("not a url", HOSTS)).toBe(false);
  });
});

describe("pickWeek", () => {
  it("uses latest, or the newest of weeks when latest is missing", () => {
    expect(pickWeek({ latest: "2026-W41", weeks: ["2026-W40", "2026-W41"] }, undefined)).toBe(
      "2026-W41",
    );
    expect(pickWeek({ weeks: ["2026-W39", "2026-W41", "2026-W40"] }, "latest")).toBe("2026-W41");
  });
  it("honours a requested week that exists and rejects one that does not", () => {
    expect(pickWeek({ latest: "2026-W41", weeks: ["2026-W40", "2026-W41"] }, "2026-W40")).toBe(
      "2026-W40",
    );
    expect(() => pickWeek({ weeks: ["2026-W41"] }, "2026-W30")).toThrow(/No snapshot for 2026-W30/);
    expect(() => pickWeek({}, "../etc")).toThrow(SnapshotSourceError);
  });
  it("says so when nothing is published", () => {
    expect(() => pickWeek({ weeks: [] }, undefined)).toThrow(/No snapshots have been published/);
    expect(() => pickWeek(null, undefined)).toThrow(/No snapshots have been published/);
  });
});

describe("loadSnapshot", () => {
  const cfg = (fetchImpl: typeof fetch) => ({
    base: BASE,
    org: "Mantequilla-Soft",
    allowedHosts: HOSTS,
    fetchImpl,
  });

  it("reads index.json and loads the newest week", async () => {
    const fetchImpl = fetchFrom({
      [`${BASE}/Mantequilla-Soft/index.json`]: () =>
        reply({ org: "Mantequilla-Soft", latest: "2026-W41", weeks: ["2026-W40", "2026-W41"] }),
      [`${BASE}/Mantequilla-Soft/2026-W41.json`]: () => reply(snap()),
    });
    const r = await loadSnapshot({}, cfg(fetchImpl));
    expect(r.label).toBe("Mantequilla-Soft 2026-W41");
    expect(r.snapshot.events.length).toBeGreaterThan(0);
  });

  it("loads a specific week without reading the index", async () => {
    const fetchImpl = fetchFrom({
      [`${BASE}/Mantequilla-Soft/2026-W40.json`]: () => reply(snap()),
    });
    const r = await loadSnapshot({ week: "2026-W40" }, cfg(fetchImpl));
    expect(r.url).toBe(`${BASE}/Mantequilla-Soft/2026-W40.json`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses an explicit snapshot URL on a host that is not allowed, without fetching it", async () => {
    const fetchImpl = fetchFrom({});
    await expect(
      loadSnapshot({ snapshot: "https://evil.example/x.json" }, cfg(fetchImpl)),
    ).rejects.toThrow(/not on an allowed host/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets a trusted (build-time) URL use any host", async () => {
    const fetchImpl = fetchFrom({ "https://data.example/week.json": () => reply(snap()) });
    const r = await loadSnapshot({ snapshot: "https://data.example/week.json" }, cfg(fetchImpl), {
      trusted: true,
    });
    expect(r.snapshot.org).toBeTruthy();
  });

  it("rejects bad org and week values before any request", async () => {
    const fetchImpl = fetchFrom({});
    await expect(loadSnapshot({ org: "../secrets" }, cfg(fetchImpl))).rejects.toThrow(/org name/);
    await expect(loadSnapshot({ week: "yesterday" }, cfg(fetchImpl))).rejects.toThrow(/not a week/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gives readable errors for 404, server errors, bad JSON, invalid snapshots and huge files", async () => {
    const notFound = fetchFrom({});
    await expect(loadSnapshot({}, cfg(notFound))).rejects.toThrow(/snapshot index was not found/);

    const serverError = fetchFrom({
      [`${BASE}/Mantequilla-Soft/index.json`]: () => reply("x", { status: 503 }),
    });
    await expect(loadSnapshot({}, cfg(serverError))).rejects.toThrow(/failed \(503\)/);

    const badJson = fetchFrom({
      [`${BASE}/Mantequilla-Soft/2026-W40.json`]: () => reply("{not json"),
    });
    await expect(loadSnapshot({ week: "2026-W40" }, cfg(badJson))).rejects.toThrow(
      /isn't valid JSON/,
    );

    const invalid = fetchFrom({
      [`${BASE}/Mantequilla-Soft/2026-W40.json`]: () => reply({ schemaVersion: 2 }),
    });
    await expect(loadSnapshot({ week: "2026-W40" }, cfg(invalid))).rejects.toThrow(
      /isn't valid: Unsupported schemaVersion/,
    );

    const huge = fetchFrom({
      [`${BASE}/Mantequilla-Soft/2026-W40.json`]: () =>
        reply("{}", { headers: { "content-length": String(MAX_SNAPSHOT_BYTES + 1) } }),
    });
    await expect(loadSnapshot({ week: "2026-W40" }, cfg(huge))).rejects.toThrow(/too large/);
  });

  it("reports an unreachable network as a readable error", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(loadSnapshot({}, cfg(down))).rejects.toThrow(/Couldn't reach the snapshot index/);
  });
});
