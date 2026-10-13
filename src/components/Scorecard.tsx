import { useMemo, useState } from "react";
import type { Snapshot } from "@/sim/types";

type Row = { id: string; prs: number; merges: number; approvals: number; issues: number; fixes: number; score: number };

/** Live leaderboard, counted up to the current replay moment (realMs). */
export function Scorecard({ snapshot, realMs, onPick, className = "", defaultOpen = true }: { snapshot: Snapshot; realMs: number; onPick?: (id: string) => void; className?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [all, setAll] = useState(false);
  const people = useMemo(() => new Map(snapshot.people.map((p) => [p.id, p])), [snapshot]);
  const rows = useMemo(() => {
    const author = new Map<string, string>();
    const m = new Map<string, Row>();
    const row = (id: string) => m.get(id) ?? (m.set(id, { id, prs: 0, merges: 0, approvals: 0, issues: 0, fixes: 0, score: 0 }), m.get(id)!);
    for (const e of snapshot.events) {
      if (e.type === "pr_opened") author.set(e.prId, e.actor);
      if (Date.parse(e.at) > realMs) continue;
      if (e.type === "pr_opened") row(e.actor).prs++;
      if (e.type === "pr_merged") row(author.get(e.prId) ?? e.actor).merges++;
      if (e.type === "review_approved") row(e.actor).approvals++;
    }
    for (const x of snapshot.issues ?? []) {
      if (Date.parse(x.openedAt) <= realMs) row(x.actor).issues++;
      if (x.closedAt && x.closedBy && Date.parse(x.closedAt) <= realMs) row(x.closedBy).fixes++;
    }
    for (const r of m.values()) r.score = r.merges * 3 + r.prs + r.approvals * 2 + r.issues + r.fixes * 2;
    return [...m.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }, [snapshot, realMs]);
  const shown = all ? rows : rows.slice(0, 5);

  return (
    <section className={`border-2 border-border bg-card text-[11px] ${className}`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full justify-between border-b border-border px-3 py-2 text-xs text-primary">
        <span>SCORECARD</span><span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="p-2">
          {rows.length === 0 ? <p className="p-1 text-muted-foreground">Nobody has clocked in yet.</p> : (
            <table className="w-full tabular-nums">
              <thead className="text-muted-foreground">
                <tr><th className="text-left font-normal">WHO</th>
                  {["PRS", "MRG", "APP", "ISS", "FIX"].map((h) => <th key={h} className="w-8 text-right font-normal" title={{ PRS: "PRs opened", MRG: "PRs merged", APP: "Reviews approved", ISS: "Issues opened", FIX: "Issues closed" }[h]}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const p = people.get(r.id);
                  return (
                    <tr key={r.id} className="hover:bg-secondary">
                      <td className="py-0.5">
                        <button onClick={() => onPick?.(r.id)} className="flex max-w-36 items-center gap-1.5 text-left hover:text-accent">
                          <span className="w-3 text-muted-foreground">{i + 1}</span>
                          <img src={p?.avatarUrl ?? `https://github.com/${r.id.replace("[bot]", "")}.png?size=32`} alt="" width={16} height={16}
                            className="h-4 w-4 shrink-0 bg-primary" style={{ imageRendering: "pixelated" }}
                            onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                          <span className="truncate">{p?.displayName ?? r.id}</span>
                        </button>
                      </td>
                      <td className="text-right">{r.prs}</td>
                      <td className="text-right text-success">{r.merges}</td>
                      <td className="text-right">{r.approvals}</td>
                      <td className="text-right text-accent">{r.issues}</td>
                      <td className="text-right text-primary">{r.fixes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {rows.length > 5 && <button onClick={() => setAll(!all)} className="mt-1 text-muted-foreground hover:text-accent">{all ? "show top 5" : `show all ${rows.length}`}</button>}
        </div>
      )}
    </section>
  );
}
