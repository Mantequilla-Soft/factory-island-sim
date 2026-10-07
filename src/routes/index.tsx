import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { sampleWeek } from "@/sim/fixture";
import { compile, stateAt, DURATION, W, H, EVENT_LABEL } from "@/sim/sim";
import { draw } from "@/sim/render";

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
const fmt = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

function Index() {
  const compiled = useMemo(() => compile(sampleWeek()), []);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [selected, setSelected] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = useMemo(() => stateAt(compiled, t), [compiled, t]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setT((p) => { const n = p + dt * speed; if (n >= DURATION) { setPlaying(false); return DURATION; } return n; });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.imageSmoothingEnabled = false; draw(ctx, compiled, world, selected); }
  }, [compiled, world, selected]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    const hit = compiled.islands.find((i) => Math.hypot((x - i.center.x) / 1, (y - i.center.y) / 0.62) < 30);
    setSelected(hit ? hit.id : null);
  };

  const people = new Map(compiled.snapshot.people.map((p) => [p.id, p]));
  const repoName = (id: string) => compiled.snapshot.repos.find((r) => r.id === id)?.name ?? id;
  const feed = compiled.feed.filter((s) => s.at <= t).slice(-40).reverse();
  const sel = selected ? world.islands.find((i) => i.id === selected) : null;
  const selRepo = selected ? compiled.snapshot.repos.find((r) => r.id === selected) : null;

  return (
    <main className="min-h-screen bg-background text-foreground font-mono">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-6 py-4">
        <h1 className="font-display text-lg text-primary">BUTTER FACTORY</h1>
        <p className="text-xs text-muted-foreground">{compiled.snapshot.org} · week of {compiled.snapshot.weekStart.slice(0, 10)} · sample fixture</p>
      </header>
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
        <section className="space-y-3">
          <div className="relative border-4 border-border bg-card">
            <canvas ref={canvasRef} width={W} height={H} onClick={onClick}
              className="block w-full cursor-pointer" style={{ imageRendering: "pixelated", aspectRatio: `${W}/${H}` }} />
            {sel && selRepo && (
              <div className="absolute right-2 top-2 w-56 border-2 border-accent bg-card p-3 text-xs">
                <div className="flex justify-between"><b className="text-accent">{selRepo.name}</b>
                  <button onClick={() => setSelected(null)} aria-label="Close">×</button></div>
                <p className="mt-1">Buildings: {sel.buildings}</p>
                <p>Merged this week: {sel.mergedThisWeek}</p>
                <p>In dock queue: {sel.queue}</p>
                <p className="mt-2 text-muted-foreground">Recent items</p>
                {sel.recent.length ? sel.recent.map((r) => <p key={r.prId}>· {r.kind} <span className="text-muted-foreground">{selRepo.anonymized ? "" : r.prId}</span></p>) : <p>—</p>}
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
          <p className="text-xs text-muted-foreground">Click an island for details. Nights & weekends are compressed; a week plays in {DURATION}s at 1x.</p>
        </section>
        <aside className="flex max-h-[80vh] flex-col border-2 border-border bg-card" aria-live="polite">
          <h2 className="border-b border-border p-3 text-xs text-primary">ACTIVITY FEED</h2>
          <ol className="flex-1 space-y-2 overflow-y-auto p-3 text-xs">
            {feed.length === 0 && <li className="text-muted-foreground">Press play to start the week.</li>}
            {feed.map((s, i) => (
              <li key={`${s.ev.prId}-${s.ev.type}-${i}`} className="border-l-2 border-accent pl-2">
                <div className="text-muted-foreground">{fmt(Date.parse(s.ev.at))}</div>
                <span className="text-success">{people.get(s.ev.actor)?.displayName ?? s.ev.actor}</span>{" "}
                {EVENT_LABEL[s.ev.type]} a <b>{s.ev.itemKind}</b> → {repoName(s.ev.repo)}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </main>
  );
}
