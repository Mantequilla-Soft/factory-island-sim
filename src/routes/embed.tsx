import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compile, stateAt, DURATION } from "@/sim/sim";
import { draw, RW as W, RH as H, screenToWorld, islandGeo, workerAt } from "@/sim/render";
import { FIXTURES } from "@/sim/fixture";
import type { Snapshot } from "@/sim/types";
import { ALLOWED_SNAPSHOT_HOSTS, DEFAULT_ORG, SNAPSHOTS_BASE, prNumber } from "@/lib/env";
import { loadSnapshot } from "@/lib/snapshotSource";
import { SPEEDS, emit, parentOrigin, parseCommand, type EmbedEvent } from "@/lib/embedProtocol";

/**
 * Chrome-less player meant to be framed by another site.
 *
 *   /embed                              latest week of the default org
 *   /embed?org=Mantequilla-Soft&week=2026-W40
 *   /embed?snapshot=https://raw.githubusercontent.com/…/2026-W40.json
 *   &autoplay=1 &speed=2 &controls=0 &title=0 &parent=https://host.example &demo=1
 *
 * See README "Embedding" for the postMessage commands and events.
 */
// Only what the URL actually carried: TanStack redirects to a "canonical" URL when validated
// search differs from the request, so defaults are applied in the component, not here.
type Flag = boolean | number | string;
type EmbedSearch = {
  snapshot?: string;
  org?: string;
  week?: string;
  autoplay?: Flag;
  speed?: number;
  controls?: Flag;
  title?: Flag;
  parent?: string;
  demo?: Flag;
};

const flag = (v: unknown, fallback: boolean) =>
  v === undefined ? fallback : v === true || v === 1 || v === "1" || v === "true";
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const FLAGS = ["autoplay", "controls", "title", "demo"] as const;
const TEXTS = ["snapshot", "org", "week", "parent"] as const;

export const Route = createFileRoute("/embed")({
  validateSearch: (s: { [k: string]: unknown }): EmbedSearch => {
    const out: EmbedSearch = {};
    for (const k of TEXTS) {
      const v = text(s[k]);
      if (v !== undefined) out[k] = v;
    }
    for (const k of FLAGS) {
      const v = s[k];
      if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") out[k] = v;
    }
    const sp = SPEEDS.find((x) => x === Number(s["speed"]));
    if (sp !== undefined) out.speed = sp;
    return out;
  },
  head: () => ({
    meta: [{ title: "Butter Factory" }, { name: "robots", content: "noindex" }],
  }),
  component: Embed,
});

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (ms: number) => {
  const d = new Date(ms);
  return `${DAYS[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};
const btn =
  "border-2 border-border bg-secondary px-3 py-2 text-xs text-secondary-foreground hover:border-accent disabled:opacity-50";

function Embed() {
  const raw = Route.useSearch();
  const search = {
    ...raw,
    autoplay: flag(raw.autoplay, false),
    controls: flag(raw.controls, true),
    title: flag(raw.title, true),
    demo: flag(raw.demo, false),
    speed: raw.speed ?? 1,
  };
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [weekOverride, setWeekOverride] = useState<string | undefined>(undefined);
  const [reload, setReload] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(search.speed);
  const [selWorker, setSelWorker] = useState<string | null>(null);
  const [selIsland, setSelIsland] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const origin = useRef<string | null>(null);
  const lastSeekEmit = useRef(0);

  const compiled = useMemo(() => (snapshot ? compile(snapshot) : null), [snapshot]);
  const world = useMemo(() => (compiled ? stateAt(compiled, t) : null), [compiled, t]);

  const send = useCallback((event: EmbedEvent) => {
    if (typeof window === "undefined" || window.parent === window) return;
    emit(event, window.parent, origin.current);
  }, []);

  useEffect(() => {
    origin.current = parentOrigin(search.parent, document.referrer);
    send({ type: "ready" });
  }, [search.parent, send]);

  // load the snapshot (again when the host asks for another week, or on retry)
  useEffect(() => {
    const ctl = new AbortController();
    setStatus("loading");
    setPlaying(false);
    setT(0);
    setSelWorker(null);
    setSelIsland(null);
    const done = (s: Snapshot) => {
      setSnapshot(s);
      setStatus("ready");
      send({
        type: "week-loaded",
        org: s.org,
        weekStart: s.weekStart,
        events: s.events.length,
        repos: s.repos.length,
      });
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (search.autoplay && !reduced) setPlaying(true);
    };
    if (search.demo) {
      done(FIXTURES[0].make());
      return () => ctl.abort();
    }
    loadSnapshot(
      { snapshot: search.snapshot, org: search.org, week: weekOverride ?? search.week },
      {
        base: SNAPSHOTS_BASE,
        org: DEFAULT_ORG,
        allowedHosts: ALLOWED_SNAPSHOT_HOSTS,
        selfOrigin: window.location.origin,
        signal: ctl.signal,
      },
    )
      .then((r) => done(r.snapshot))
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message);
        setStatus("error");
        send({ type: "error", message: e.message });
      });
    return () => ctl.abort();
    // search.autoplay is only read when a snapshot arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.snapshot, search.org, search.week, search.demo, weekOverride, reload]);

  // playback clock
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setT((p) => {
        const n = p + dt * speed;
        if (n >= DURATION) {
          setPlaying(false);
          return DURATION;
        }
        return n;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const sawFirstPlayState = useRef(false);
  useEffect(() => {
    // the first run is just the initial "paused", not something the host needs to hear
    if (!sawFirstPlayState.current) {
      sawFirstPlayState.current = true;
      return;
    }
    send({ type: playing ? "play" : t >= DURATION ? "ended" : "pause" });
    // only transitions matter, not every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // stop burning CPU in a background tab
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // commands from the page that framed us
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const cmd = parseCommand(e.data);
      if (!cmd) return;
      if (cmd.command === "play") {
        setT((p) => (p >= DURATION ? 0 : p));
        setPlaying(true);
      } else if (cmd.command === "pause") setPlaying(false);
      else if (cmd.command === "seek") setT(cmd.t);
      else if (cmd.command === "speed") setSpeed(cmd.value);
      else if (cmd.command === "week") setWeekOverride(cmd.week);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && compiled && world) {
      ctx.imageSmoothingEnabled = false;
      draw(ctx, compiled, world, selIsland, selWorker);
    }
  }, [compiled, world, selIsland, selWorker]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!compiled || !world) return;
    const r = e.currentTarget.getBoundingClientRect();
    // The canvas is letterboxed (object-fit: contain) when the frame's aspect ratio differs
    // from the drawing's, so subtract the bars before scaling or clicks drift off target.
    const scale = Math.min(r.width / W, r.height / H);
    const x = (e.clientX - r.left - (r.width - W * scale) / 2) / scale;
    const y = (e.clientY - r.top - (r.height - H * scale) / 2) / scale;
    const wk = workerAt(world, x, y);
    if (wk) {
      setSelWorker(wk);
      setSelIsland(null);
      send({ type: "select", kind: "worker", id: wk });
      return;
    }
    const p = screenToWorld(x, y);
    const hit = islandGeo(compiled, world).find((g) => Math.hypot(p.x - g.x, p.y - g.y) < g.R + 8);
    setSelIsland(hit ? hit.id : null);
    setSelWorker(null);
    if (hit) send({ type: "select", kind: "island", id: hit.id });
  };

  const onSeek = (v: number) => {
    setT(v);
    const now = performance.now();
    if (now - lastSeekEmit.current > 250) {
      lastSeekEmit.current = now;
      send({ type: "seek", t: v });
    }
  };

  const wPr = selWorker && compiled ? compiled.prs.find((p) => p.prId === selWorker) : null;
  const wLast = wPr ? [...wPr.steps].reverse().find((s) => s.at <= t) : null;
  const wUrl =
    selWorker && snapshot
      ? snapshot.events.find((e) => e.prId === selWorker && e.prUrl)?.prUrl
      : undefined;
  const island = selIsland && snapshot ? snapshot.repos.find((r) => r.id === selIsland) : null;
  const islandState = selIsland && world ? world.islands.find((i) => i.id === selIsland) : null;
  const person = wPr && snapshot ? snapshot.people.find((p) => p.id === wPr.actor) : null;

  return (
    <main className="flex h-dvh min-h-64 flex-col bg-background font-mono text-foreground">
      {search.title && (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-[11px]">
          <span className="font-display text-primary">BUTTER FACTORY</span>
          {snapshot && (
            <span className="truncate text-muted-foreground">
              {snapshot.org} · week of {snapshot.weekStart.slice(0, 10)}
            </span>
          )}
        </header>
      )}

      <div className="relative min-h-0 flex-1 bg-card">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onClick={onClick}
          role="img"
          aria-label={
            snapshot
              ? `Butter Factory replay of ${snapshot.org}, week of ${snapshot.weekStart.slice(0, 10)}. Click a worker or island for details.`
              : "Butter Factory replay"
          }
          className="block h-full w-full cursor-pointer"
          style={{ imageRendering: "pixelated", objectFit: "contain" }}
        />
        {status === "loading" && (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-card/90 text-xs text-muted-foreground"
          >
            Loading the latest week…
          </p>
        )}
        {status === "error" && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-4 text-center text-xs"
          >
            <p className="text-destructive">{error}</p>
            <button className={btn} onClick={() => setReload((n) => n + 1)}>
              TRY AGAIN
            </button>
          </div>
        )}
      </div>

      {(wPr || island) && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-card px-3 py-1.5 text-[11px]"
          aria-live="polite"
        >
          {wPr && (
            <>
              <b className="text-accent">{person?.displayName ?? wPr.actor}</b>
              <span className="text-muted-foreground">
                {wPr.prId} · {wPr.kind}
              </span>
              {wLast && (
                <span className="text-muted-foreground">since {fmt(Date.parse(wLast.ev.at))}</span>
              )}
              {wUrl && (
                <a
                  href={wUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  Open PR #{prNumber(wUrl)} ↗
                </a>
              )}
            </>
          )}
          {island && islandState && (
            <>
              <b className="text-accent">{island.name}</b>
              <span className="text-muted-foreground">
                {islandState.buildings} buildings · {islandState.mergedThisWeek} merged this week ·{" "}
                {islandState.queue} in queue
              </span>
            </>
          )}
          <button
            className="ml-auto"
            aria-label="Close details"
            onClick={() => {
              setSelWorker(null);
              setSelIsland(null);
            }}
          >
            ×
          </button>
        </div>
      )}

      {search.controls && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-2 text-xs">
          <button
            className="w-20 bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
            disabled={status !== "ready"}
            onClick={() => {
              if (t >= DURATION) setT(0);
              setPlaying(!playing);
            }}
          >
            {playing ? "PAUSE" : "PLAY"}
          </button>
          <div className="flex" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
                className={`px-2 py-2 ${speed === s ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground"}`}
              >
                {s}x
              </button>
            ))}
          </div>
          <input
            id="embed-seek"
            type="range"
            min={0}
            max={DURATION}
            step={0.01}
            value={t}
            aria-label="Seek"
            disabled={status !== "ready"}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="min-w-24 flex-1 accent-primary"
          />
          <span className="tabular-nums text-accent">{world ? fmt(world.realMs) : "--"}</span>
        </div>
      )}
    </main>
  );
}
