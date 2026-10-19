import { ALLOWED_SNAPSHOT_HOSTS, DEFAULT_ORG, SNAPSHOTS_BASE, SNAPSHOT_URL, commitUrl, prNumber } from "@/lib/env";
import { loadSnapshot as loadFromSource } from "@/lib/snapshotSource";
import { floating } from "@/lib/issueAge";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FIXTURES } from "@/sim/fixture";
import { compile, stateAt, DURATION, EVENT_LABEL } from "@/sim/sim";
import { islandFocus, RW as W, RH as H, screenToWorld, islandGeo, workerAt, creatureAt } from "@/sim/render";
import { useWorldCanvas } from "@/hooks/use-world-canvas";
import { orgTheme } from "@/sim/orgTheme";
import { Scorecard } from "@/components/Scorecard";
import { ZoomControls } from "@/components/ZoomControls";
import { validateSnapshot } from "@/sim/validate";
import { RetroAudio } from "@/sim/audio";
import type { Snapshot } from "@/sim/types";
import { CollectorDialog, downloadSnapshot } from "@/components/CollectorDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Butter Factory — GitHub week replay" },
      { name: "description", content: "A pixel-art factory and repo islands replaying a week of pull requests." },
      { property: "og:title", content: "Butter Factory — GitHub week replay" },
      { property: "og:description", content: "Watch workers fabricate, queue, stamp and deliver a week of PRs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const SPEEDS = [0.5, 1, 2, 4] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (ms: number) => {
  const d = new Date(ms);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};
const btn = "border-2 border-border bg-secondary px-3 py-2 text-xs text-secondary-foreground hover:border-accent disabled:opacity-50";

function Index() {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => FIXTURES[0].make());
  const [source, setSource] = useState<string>("sample");
  const compiled = useMemo(() => compile(snapshot), [snapshot]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [selWorker, setSelWorker] = useState<string | null>(null);
  const [selIssue, setSelIssue] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [loadMsg, setLoadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fadeKey, setFadeKey] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [collectorOpen, setCollectorOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.5);
  const audio = useRef<RetroAudio | null>(null);
  const prevT = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const world = useMemo(() => stateAt(compiled, t), [compiled, t]);

  const loadSnapshot = (s: Snapshot, src: string, label: string) => {
    setPlaying(false);
    setSnapshot(s); setSource(src); setT(0); prevT.current = 0;
    setSelected(null); setSelWorker(null); setSelIssue(null); setFadeKey((k) => k + 1);
    setLoadMsg({ ok: true, text: `Loaded ${label}: ${s.events.length} events, ${s.repos.length} repos.` });
  };
  const loadJson = (text: string, src: string, label: string) => {
    try { loadSnapshot(validateSnapshot(JSON.parse(text)), src, label); }
    catch (e) { setLoadMsg({ ok: false, text: e instanceof SyntaxError ? "That file isn't valid JSON." : (e as Error).message }); }
  };
  const loadUrl = async () => {
    if (!url.trim()) return;
    setLoadMsg({ ok: true, text: "Loading…" });
    try {
      const res = await fetch(url.trim());
      if (!res.ok) throw new Error(`Request failed (${res.status}).`);
      loadJson(await res.text(), "custom", url.trim().split("/").pop() || "snapshot");
    } catch (e) { setLoadMsg({ ok: false, text: `Couldn't fetch snapshot: ${(e as Error).message}` }); }
  };
  const loadFile = (f: File) => { void f.text().then((txt) => loadJson(txt, "custom", f.name)); };

  // On open, show the newest published week. A build-time VITE_SNAPSHOT_URL still wins when set.
  // Without one, a missing or unreachable feed just leaves the sample week showing.
  useEffect(() => {
    const ctl = new AbortController();
    const explicit = SNAPSHOT_URL || undefined;
    if (explicit) setUrl(explicit);
    loadFromSource(
      explicit ? { snapshot: explicit } : {},
      { base: SNAPSHOTS_BASE, org: DEFAULT_ORG, allowedHosts: ALLOWED_SNAPSHOT_HOSTS, signal: ctl.signal },
      { trusted: true },
    )
      .then((r) => loadSnapshot(r.snapshot, "custom", r.label))
      .catch((e: Error) => { if (explicit && e.name !== "AbortError") setLoadMsg({ ok: false, text: `Couldn't fetch snapshot: ${e.message}` }); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      setT((p) => { const n = p + dt * speed; if (n >= DURATION) { setPlaying(false); return DURATION; } return n; });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  // sound effects for events crossed during playback (not when scrubbing)
  useEffect(() => {
    const a = audio.current, prev = prevT.current;
    prevT.current = t;
    if (!a?.ready || !playing || t <= prev || t - prev > 1) return;
    if (Math.floor(t * 3) !== Math.floor(prev * 3)) a.tick();
    let n = 0;
    for (const s of compiled.feed) {
      if (s.at <= prev) continue;
      if (s.at > t || n >= 3) break;
      n++;
      ({ pr_opened: () => a.clink(), pr_ready_for_review: () => a.bleep(), review_changes_requested: () => a.buzz(),
        review_approved: () => a.stamp(), pr_merged: () => a.fanfare(), pr_closed: () => a.splash() })[s.ev.type]();
    }
    for (const x of compiled.issues) {
      if (x.open > prev && x.open <= t) a.bleep();
      if (x.close !== null && x.close > prev && x.close <= t) (x.issue.kind === "bug" ? a.splash() : a.clink());
    }
  }, [t, playing, compiled]);

  const { zoom, zoomed, zoomTo, zoomOut, zoomIn, zoomOutStep, addFx, toBase: camToBase, consumeDrag } = useWorldCanvas(canvasRef, { compiled, world, selected, selWorker, selIssue }, { wheel: "modifier" });

  const toggleMute = () => {
    if (!audio.current) audio.current = new RetroAudio();
    const a = audio.current;
    a.muted = !muted; a.volume = volume; a.ensure();
    setMuted(!muted);
    if (muted) a.bleep();
  };
  const changeVolume = (v: number) => { setVolume(v); if (audio.current) { audio.current.volume = v; audio.current.apply(); } };

  const toBase = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return camToBase(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
  };
  const islandHit = (x: number, y: number) => {
    const p = screenToWorld(x, y);
    return islandGeo(compiled, world).find((g) => Math.hypot(p.x - g.x, p.y - g.y) < g.R + 8);
  };
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (consumeDrag()) return;
    const { x, y } = toBase(e);
    const wk = workerAt(world, x, y);
    if (wk) { setSelWorker(wk); setSelected(null); setSelIssue(null); return; }
    const cr = creatureAt(world, x, y);
    if (cr) {
      setSelIssue(cr); setSelWorker(null); setSelected(null);
      const kind = world.creatures.find((c) => c.id === cr)?.kind;
      if (kind === "bug") { addFx({ kind: "ripple", x, y, born: performance.now() }); audio.current?.bloop(); }
      else { addFx({ kind: "honk", id: cr, born: performance.now() }); audio.current?.honk(); }
      return;
    }
    setSelIssue(null);
    const hit = islandHit(x, y);
    setSelected(hit ? hit.id : null);
    setSelWorker(null);
    if (!hit) { addFx({ kind: "ripple", x, y, born: performance.now() }); audio.current?.bloop(); }
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toBase(e);
    const hit = islandHit(x, y);
    if (hit) { const f = islandFocus(compiled, world, hit.id); if (f) zoomTo(f); }
    else if (zoomed) zoomOut();
  };

  const people = new Map(snapshot.people.map((p) => [p.id, p]));
  const theme = orgTheme(snapshot.org);
  const title = theme.label === "BUTTER" && snapshot.org.toLowerCase() === "mantequilla-soft" ? "BUTTER FACTORY" : `${snapshot.org.toUpperCase()} FACTORY`;
  // scorecard pick: spotlight the person's active worker, else their latest PR
  const pickPerson = (id: string) => {
    const active = world.workers.find((w) => w.actor === id);
    const last = [...compiled.prs].filter((p) => p.actor === id && p.steps[0]!.at <= t).pop();
    const pr = active?.prId ?? last?.prId;
    if (pr) { setSelWorker(pr); setSelIssue(null); setSelected(null); }
  };
  const ISSUE_LABEL = { bug: "bug monster", enhancement: "enhancement tugboat", task: "task rowboat" } as const;
  const issueFeed = compiled.issues.flatMap((x) => [
    ...(x.open <= t ? [{ at: x.issue.openedAt, issue: x.issue, closed: false }] : []),
    ...(x.close !== null && x.close <= t && x.issue.closedAt ? [{ at: x.issue.closedAt, issue: x.issue, closed: true }] : []),
  ]);
  const issueNo = (u?: string) => u?.split("/").pop();
  const iSel = selIssue ? snapshot.issues?.find((x) => x.id === selIssue) : null;
  const iState = selIssue ? world.creatures.find((c) => c.id === selIssue) : null;
  const repoName = (id: string) => snapshot.repos.find((r) => r.id === id)?.name ?? id;
  type FeedItem = { at: string; pr?: (typeof compiled.feed)[number]; iss?: (typeof issueFeed)[number] };
  const feed: FeedItem[] = [
    ...compiled.feed.filter((s) => s.at <= t).map((s) => ({ at: s.ev.at, pr: s })),
    ...issueFeed.map((x) => ({ at: x.at, iss: x })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  const sel = selected ? world.islands.find((i) => i.id === selected) : null;
  // keep the island card off the island itself (it would swallow a double-click zoom)
  const selGeo = selected ? islandGeo(compiled, world).find((g) => g.id === selected) : null;
  const selOnRight = !!selGeo && selGeo.x - selGeo.y > 0; // iso screen x relative to the centre
  const selRepo = selected ? snapshot.repos.find((r) => r.id === selected) : null;

  // worker inspection
  const wState = selWorker ? world.workers.find((w) => w.prId === selWorker) : null;
  const wPr = selWorker ? compiled.prs.find((p) => p.prId === selWorker) : null;
  const wLast = wPr ? [...wPr.steps].reverse().find((s) => s.at <= t) : null;
  const wPerson = wPr ? people.get(wPr.actor) : null;
  const wStatus = wState ? wState.phase : wLast?.ev.type === "pr_merged" ? "delivered" : wLast?.ev.type === "pr_closed" ? "scrapped" : "off shift";
  const wEvents = selWorker ? snapshot.events.filter((e) => e.prId === selWorker) : [];
  const wLink = { url: wEvents.find((e) => e.prUrl)?.prUrl, sha: wEvents.find((e) => e.commitSha)?.commitSha };

  const summary = useMemo(() => {
    const ev = snapshot.events;
    const count = (type: string) => ev.filter((e) => e.type === type).length;
    const tally = (keys: string[]) => {
      const m = new Map<string, number>();
      keys.forEach((k) => m.set(k, (m.get(k) ?? 0) + 1));
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    };
    const merged = ev.filter((e) => e.type === "pr_merged");
    return {
      opened: count("pr_opened"), merged: merged.length, closed: count("pr_closed"), approved: count("review_approved"),
      contributors: tally(ev.filter((e) => e.type === "pr_opened").map((e) => e.actor)).slice(0, 5),
      reviewers: tally(ev.filter((e) => e.type === "review_approved").map((e) => e.actor)).slice(0, 3),
      repos: tally(ev.map((e) => e.repo)).slice(0, 5),
      items: tally(merged.map((e) => e.itemKind)),
    };
  }, [snapshot]);
  const maxRepo = summary.repos[0]?.[1] ?? 1;

  return (
    <main className="min-h-screen bg-background font-mono text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h1 className="font-display text-lg text-primary">{title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{snapshot.org} · week of {snapshot.weekStart.slice(0, 10)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setCollectorOpen(true)} className="border-2 border-primary bg-primary px-3 py-2 text-xs text-primary-foreground">FETCH GITHUB ORG</button>
          <button onClick={() => setSummaryOpen(true)} className={btn}>WEEK IN NUMBERS</button>
          <button onClick={() => downloadSnapshot(snapshot, `${snapshot.org}-${snapshot.weekStart.slice(0, 10)}.json`)} className={btn}>DOWNLOAD JSON</button>
          <button onClick={toggleMute} aria-pressed={!muted} aria-label={muted ? "Turn sound on" : "Mute sound"}
            className={`border-2 px-3 py-2 text-xs ${muted ? "border-border bg-secondary text-secondary-foreground" : "border-accent bg-accent text-accent-foreground"}`}>
            {muted ? "♪ SOUND OFF" : "♪ SOUND ON"}
          </button>
          <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Volume" disabled={muted} className="w-20 accent-accent disabled:opacity-40" />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3 text-xs">
        <label htmlFor="week" className="text-muted-foreground">WEEK</label>
        <select id="week" value={source} className="border-2 border-border bg-card px-2 py-2"
          onChange={(e) => { const f = FIXTURES.find((x) => x.id === e.target.value); if (f) loadSnapshot(f.make(), f.id, f.label); }}>
          {FIXTURES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          {source === "custom" && <option value="custom">Custom snapshot</option>}
        </select>
        <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void loadUrl(); }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/snapshots/org/2026-W40.json"
            aria-label="Snapshot URL" className="min-w-40 flex-1 border-2 border-border bg-card px-2 py-2 placeholder:text-muted-foreground" />
          <button className={btn} disabled={!url.trim()}>LOAD URL</button>
        </form>
        <button className={btn} onClick={() => fileRef.current?.click()}>UPLOAD JSON</button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
        {loadMsg && <p role="status" className={`w-full ${loadMsg.ok ? "text-success" : "text-destructive"}`}>{loadMsg.text}</p>}
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
        <section className="space-y-3"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}>
          <div key={fadeKey} className="relative border-4 border-border bg-card duration-500 animate-in fade-in">
            <canvas ref={canvasRef} width={W} height={H} onClick={onClick} onDoubleClick={onDoubleClick}
              className={`block w-full ${zoomed ? "cursor-grab" : "cursor-pointer"}`}
              style={{ imageRendering: "pixelated", aspectRatio: `${W}/${H}`, touchAction: zoomed ? "none" : "auto" }} />
            <Scorecard snapshot={snapshot} realMs={world.realMs} onPick={pickPerson} defaultOpen={false}
              className="absolute bottom-2 right-2 z-10 w-72 max-w-[calc(100%-1rem)] bg-card/95 [&_table]:max-h-40" />
            <ZoomControls zoom={zoom} onIn={zoomIn} onOut={zoomOutStep} onReset={zoomOut} className="absolute bottom-2 left-2 z-10" />
            {zoomed && (
              <p className="pointer-events-none absolute bottom-2 left-12 z-10 hidden bg-card/80 px-2 py-1 text-[10px] text-muted-foreground sm:block">
                drag to pan · ctrl+scroll to zoom
              </p>
            )}
            {dragging && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-4 border-dashed border-accent bg-background/80 text-sm text-accent">
                DROP SNAPSHOT JSON TO LOAD
              </div>
            )}
            {sel && selRepo && (
              <div className={`absolute top-2 w-56 border-2 border-accent bg-card p-3 text-xs ${selOnRight ? "left-2" : "right-2"}`}>
                <div className="flex justify-between"><b className="text-accent">{selRepo.name}</b>
                  <button onClick={() => setSelected(null)} aria-label="Close">×</button></div>
                <p className="mt-1">Buildings: {sel.buildings}</p>
                <p>Merged this week: {sel.mergedThisWeek}</p>
                <p>In dock queue: {sel.queue}</p>
                <p className="mt-2 text-muted-foreground">Recent items</p>
                {sel.recent.length ? sel.recent.map((r) => <p key={r.prId}>· {r.kind} <span className="text-muted-foreground">{selRepo.anonymized ? "" : r.prId}</span></p>) : <p>—</p>}
              </div>
            )}
            {wPr && (
              <div className="absolute left-2 top-2 w-60 border-2 border-accent bg-card p-3 text-xs">
                <div className="flex items-start gap-2">
                  <div className="relative h-10 w-10 shrink-0 border-2 border-border bg-primary">
                    <span className="absolute inset-0 flex items-center justify-center text-primary-foreground">{wPr.actor[0]?.toUpperCase()}</span>
                    <img src={wPerson?.avatarUrl ?? `https://github.com/${wPr.actor.replace("[bot]", "")}.png?size=40`} alt=""
                      className="absolute inset-0 h-full w-full" style={{ imageRendering: "pixelated" }}
                      onError={(e) => (e.currentTarget.style.display = "none")} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-accent">{wPerson?.displayName ?? wPr.actor}</b>
                    <span className="text-muted-foreground">@{wPr.actor}{wPerson?.isBot ? " · bot" : ""}</span>
                  </div>
                  <button onClick={() => setSelWorker(null)} aria-label="Close">×</button>
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">PR</dt><dd>{wPr.prId}</dd>
                  <dt className="text-muted-foreground">Island</dt><dd>{repoName(wPr.repo)}</dd>
                  <dt className="text-muted-foreground">Item</dt><dd>{wPr.kind}</dd>
                  <dt className="text-muted-foreground">State</dt><dd className="uppercase text-primary">{wStatus}{wState?.stamped && wState.phase !== "stamped" ? " · stamped" : ""}</dd>
                  <dt className="text-muted-foreground">Since</dt><dd>{wLast ? fmt(Date.parse(wLast.ev.at)) : "—"}</dd>
                  {wLink.sha && <><dt className="text-muted-foreground">Commit</dt><dd>
                    {wLink.url ? <a href={commitUrl(wLink.url, wLink.sha)} target="_blank" rel="noopener noreferrer" className="border border-border px-1 text-primary hover:border-accent">{wLink.sha}</a> : wLink.sha}
                  </dd></>}
                </dl>
                {wLink.url && (
                  <a href={wLink.url} target="_blank" rel="noopener noreferrer" className="mt-2 block text-accent hover:underline">
                    Open PR #{prNumber(wLink.url)} on GitHub ↗
                  </a>
                )}
              </div>
            )}
            {iSel && (
              <div className="absolute left-2 top-2 w-60 border-2 border-accent bg-card p-3 text-xs">
                <div className="flex justify-between"><b className="text-accent uppercase">{ISSUE_LABEL[iSel.kind]}</b>
                  <button onClick={() => setSelIssue(null)} aria-label="Close">×</button></div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Issue</dt><dd>{iSel.url ? `#${issueNo(iSel.url)}` : "hidden"}</dd>
                  <dt className="text-muted-foreground">Floating</dt><dd className="text-primary">{floating(iSel, world.realMs)}</dd>
                  <dt className="text-muted-foreground">Labels</dt><dd className="flex flex-wrap gap-1">{(iSel.labels?.length ? iSel.labels : [iSel.kind]).map((l) => (
                    <span key={l} className="border border-accent bg-secondary px-1 text-[9px] uppercase leading-4 text-accent">{l}</span>))}</dd>
                  <dt className="text-muted-foreground">Assignee</dt><dd>{iSel.assignee ? people.get(iSel.assignee)?.displayName ?? iSel.assignee : <span className="text-muted-foreground">nobody yet</span>}</dd>
                  <dt className="text-muted-foreground">Island</dt><dd>{repoName(iSel.repo)}</dd>
                  <dt className="text-muted-foreground">Opened by</dt><dd>{people.get(iSel.actor)?.displayName ?? iSel.actor}</dd>
                  <dt className="text-muted-foreground">Opened</dt><dd>{fmt(Date.parse(iSel.openedAt))}</dd>
                  <dt className="text-muted-foreground">State</dt><dd className="uppercase text-primary">{iState?.phase === "resolving" || (iSel.closedAt && Date.parse(iSel.closedAt) <= world.realMs) ? "closed" : "open"}</dd>
                  {iSel.closedAt && Date.parse(iSel.closedAt) <= world.realMs && <><dt className="text-muted-foreground">Closed</dt><dd>{fmt(Date.parse(iSel.closedAt))}{iSel.closedBy ? ` by ${people.get(iSel.closedBy)?.displayName ?? iSel.closedBy}` : ""}</dd></>}
                </dl>
                {iSel.url && <a href={iSel.url} target="_blank" rel="noopener noreferrer" className="mt-2 block text-accent hover:underline">Open issue #{issueNo(iSel.url)} on GitHub ↗</a>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-2 border-border bg-card p-3 text-xs">
            <button onClick={() => { if (t >= DURATION) setT(0); setPlaying(!playing); }}
              className="w-20 bg-primary px-3 py-2 text-primary-foreground">{playing ? "PAUSE" : "PLAY"}</button>
            <div className="flex">
              {SPEEDS.map((s) => (
                <button key={s} onClick={() => setSpeed(s)}
                  className={`px-2 py-2 ${speed === s ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground"}`}>{s}x</button>
              ))}
            </div>
            <input type="range" min={0} max={DURATION} step={0.01} value={t} aria-label="Seek"
              onChange={(e) => setT(Number(e.target.value))} className="min-w-40 flex-1 accent-primary" />
            <span className="tabular-nums text-accent">{fmt(world.realMs)}</span>
          </div>
          <p className="text-xs text-muted-foreground">Click a worker, island, sea monster or boat to inspect it (boats honk back). Click open water to splash. Double-click an island to zoom in, Esc to zoom out. Drop a snapshot JSON anywhere on the map to load it.</p>
        </section>
        <div className="flex flex-col gap-4">
        <aside className="flex max-h-[70vh] flex-col border-2 border-border bg-card" aria-live="polite">
          <h2 className="border-b border-border p-3 text-xs text-primary">ACTIVITY FEED</h2>
          <ol className="flex-1 space-y-2 overflow-y-auto p-3 text-xs">
            {feed.length === 0 && <li className="text-muted-foreground">Press play to start the week.</li>}
            {feed.map((f, i) => {
              if (f.iss) {
                const x = f.iss.issue;
                return (
                  <li key={`${x.id}-${f.iss.closed}-${i}`} className="border-l-2 border-primary pl-2">
                    <div className="text-muted-foreground">{fmt(Date.parse(f.at))}</div>
                    <span className="text-success">{people.get(f.iss.closed ? x.closedBy ?? x.actor : x.actor)?.displayName ?? (f.iss.closed ? x.closedBy ?? "someone" : x.actor)}</span>{" "}
                    <button className="text-left hover:text-accent hover:underline" onClick={() => { setSelIssue(x.id); setSelWorker(null); }}>
                      {f.iss.closed ? (x.kind === "bug" ? "squashed a" : "sent off a") : "spotted a"} <b>{ISSUE_LABEL[x.kind]}</b>
                    </button> near {repoName(x.repo)}{" "}
                    {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">#{issueNo(x.url)}</a> : null}
                  </li>
                );
              }
              const s = f.pr!;
              return (
              <li key={`${s.ev.prId}-${s.ev.type}-${i}`} className="border-l-2 border-accent pl-2">
                <div className="text-muted-foreground">{fmt(Date.parse(s.ev.at))}</div>
                <button className="text-left text-success hover:underline" onClick={() => setSelWorker(s.ev.prId)}>
                  {people.get(s.ev.actor)?.displayName ?? s.ev.actor}
                </button>{" "}
                {s.ev.prUrl
                  ? <a href={s.ev.prUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{EVENT_LABEL[s.ev.type]} a <b>{s.ev.itemKind}</b></a>
                  : <>{EVENT_LABEL[s.ev.type]} a <b>{s.ev.itemKind}</b></>} → {repoName(s.ev.repo)}{" "}
                {s.ev.prUrl
                  ? <a href={s.ev.prUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">#{prNumber(s.ev.prUrl)}</a>
                  : <span className="text-muted-foreground">{s.ev.prId}</span>}
                {s.ev.prUrl && s.ev.commitSha && (
                  <> <a href={commitUrl(s.ev.prUrl, s.ev.commitSha)} target="_blank" rel="noopener noreferrer" className="border border-border px-1 text-primary hover:border-accent">{s.ev.commitSha}</a></>
                )}
              </li>
              );
            })}
          </ol>
        </aside>
        </div>
      </div>

      <CollectorDialog open={collectorOpen} onOpenChange={setCollectorOpen} onLoaded={(s, label) => loadSnapshot(s, "custom", label)} />

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-lg rounded-none border-4 border-border bg-card font-mono">
          <DialogHeader>
            <DialogTitle className="font-display text-sm text-primary">WEEK IN NUMBERS</DialogTitle>
            <DialogDescription>{snapshot.org} · {snapshot.weekStart.slice(0, 10)} → {snapshot.weekEnd.slice(0, 10)}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[["OPENED", summary.opened, "text-accent"], ["APPROVED", summary.approved, "text-foreground"], ["MERGED", summary.merged, "text-success"], ["SCRAPPED", summary.closed, "text-destructive"]].map(([l, v, c]) => (
              <div key={l as string} className="border-2 border-border p-2">
                <div className={`font-display text-lg ${c}`}>{v}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-4 text-xs sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-primary">TOP CONTRIBUTORS</h3>
              <ol>{summary.contributors.map(([id, n], i) => <li key={id}>{i + 1}. {people.get(id)?.displayName ?? id} <span className="text-muted-foreground">· {n} PRs</span></li>)}</ol>
              <h3 className="mb-1 mt-3 text-primary">TOP STAMPERS</h3>
              <ol>{summary.reviewers.length ? summary.reviewers.map(([id, n]) => <li key={id}>{people.get(id)?.displayName ?? id} <span className="text-muted-foreground">· {n}</span></li>) : <li>—</li>}</ol>
            </div>
            <div>
              <h3 className="mb-1 text-primary">MOST ACTIVE ISLANDS</h3>
              <ul className="space-y-1">{summary.repos.map(([id, n]) => (
                <li key={id}><div className="flex justify-between"><span>{repoName(id)}</span><span className="text-muted-foreground">{n}</span></div>
                  <div className="h-1.5 bg-secondary"><div className="h-full bg-primary" style={{ width: `${(n / maxRepo) * 100}%` }} /></div></li>
              ))}</ul>
              <h3 className="mb-1 mt-3 text-primary">ITEMS DELIVERED</h3>
              <div className="flex flex-wrap gap-1">{summary.items.length ? summary.items.map(([k, n]) => (
                <span key={k} className="border border-border px-2 py-1">{k} ×{n}</span>)) : <span>—</span>}</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
