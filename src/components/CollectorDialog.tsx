import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { collect, lastCompleteWeek, type PrivateRepoMode } from "@/collector/core";
import type { Snapshot } from "@/sim/types";
import workflowYaml from "../../.github/workflows/collector.yml?raw";

const field = "w-full border-2 border-border bg-background px-2 py-2 text-xs placeholder:text-muted-foreground";
const btn = "border-2 border-border bg-secondary px-3 py-2 text-xs text-secondary-foreground hover:border-accent disabled:opacity-50";

export function downloadSnapshot(s: Snapshot, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Copy({ text, label = "COPY" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={btn} onClick={() => { void navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? "COPIED ✓" : label}
    </button>
  );
}

export function CollectorDialog({ open, onOpenChange, onLoaded }: { open: boolean; onOpenChange: (o: boolean) => void; onLoaded: (s: Snapshot, label: string) => void }) {
  const [org, setOrg] = useState("Mantequilla-Soft");
  const [week, setWeek] = useState(() => lastCompleteWeek());
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<PrivateRepoMode>("anonymize");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ s: Snapshot; week: string } | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null); setLog([]);
    try {
      const { snapshot, stats } = await collect({
        org, week, token: token.trim() || undefined, privateRepos: mode,
        onProgress: (m) => setLog((l) => [...l.slice(-30), m]),
      });
      if (stats.truncated) setLog((l) => [...l, "Note: capped at 250 pull requests for the in-app collector."]);
      setResult({ s: snapshot, week });
      onLoaded(snapshot, `${org} ${week}`);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-none border-4 border-border bg-card font-mono">
        <DialogHeader>
          <DialogTitle className="font-display text-sm text-primary">GITHUB COLLECTOR</DialogTitle>
          <DialogDescription>Turn a real org's week of pull requests into a Butter Factory snapshot.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="fetch">
          <TabsList className="rounded-none">
            <TabsTrigger value="fetch" className="rounded-none text-xs">FETCH ORG</TabsTrigger>
            <TabsTrigger value="action" className="rounded-none text-xs">GITHUB ACTION SETUP</TabsTrigger>
          </TabsList>

          <TabsContent value="fetch">
            <form className="grid gap-3 text-xs sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
              <label className="space-y-1">
                <span className="text-muted-foreground">Organization or user</span>
                <input className={field} value={org} onChange={(e) => setOrg(e.target.value)} required />
              </label>
              <label className="space-y-1">
                <span className="text-muted-foreground">ISO week</span>
                <input className={field} value={week} onChange={(e) => setWeek(e.target.value)} placeholder="2026-W40" pattern="\d{4}-W\d{2}" required />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-muted-foreground">Read-only access token (optional)</span>
                <input className={field} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
                <span className="block text-muted-foreground">Needed for private repos, ready-for-review timing, island history and a 5,000/hour limit (60/hour without). It's used only from this browser tab and never saved.</span>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-muted-foreground">Private repositories</span>
                <select className={field} value={mode} onChange={(e) => setMode(e.target.value as PrivateRepoMode)}>
                  <option value="anonymize">Show as "Mystery Island" (default)</option>
                  <option value="exclude">Leave them out</option>
                  <option value="include">Show real names</option>
                </select>
              </label>
              <p className="text-muted-foreground sm:col-span-2">Only timestamps, people and a derived item kind are kept. Titles, descriptions and branch names never enter the snapshot.</p>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button className="bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={busy}>{busy ? "COLLECTING…" : "FETCH & REPLAY"}</button>
                {result && <button type="button" className={btn} onClick={() => downloadSnapshot(result.s, `${result.s.org}-${result.week}.json`)}>DOWNLOAD JSON</button>}
                {result && <button type="button" className={btn} onClick={() => onOpenChange(false)}>WATCH IT</button>}
              </div>
            </form>
            {(log.length > 0 || error) && (
              <pre className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap border-2 border-border bg-background p-2 text-[11px]" aria-live="polite">
                {log.join("\n")}
                {error && <span className="block text-destructive">{error}</span>}
              </pre>
            )}
          </TabsContent>

          <TabsContent value="action" className="space-y-3 text-xs">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Copy <code className="text-accent">scripts/collector.ts</code> and <code className="text-accent">src/collector/core.ts</code> (plus <code className="text-accent">src/sim/types.ts</code> and <code className="text-accent">src/sim/validate.ts</code>) into your repo.</li>
              <li>Create a fine-grained token with <b>read-only</b> access to the org's repositories (Pull requests: read, Metadata: read). Save it as the repo secret <code className="text-accent">COLLECTOR_TOKEN</code>.</li>
              <li>Optionally set repo variables <code className="text-accent">BUTTER_ORG</code> and <code className="text-accent">BUTTER_PRIVATE_REPOS</code> (anonymize / exclude / include).</li>
              <li>Add the workflow below as <code className="text-accent">.github/workflows/collector.yml</code>. It runs every Monday and from the Actions tab ("Run workflow").</li>
              <li>Snapshots land on the <code className="text-accent">data</code> branch at <code className="text-accent">snapshots/&lt;org&gt;/&lt;week&gt;.json</code> with an <code className="text-accent">index.json</code>. Load one here with its raw URL, e.g. <code className="break-all text-accent">https://raw.githubusercontent.com/&lt;owner&gt;/&lt;repo&gt;/data/snapshots/&lt;org&gt;/2026-W40.json</code>.</li>
            </ol>
            <div className="flex items-center justify-between">
              <span className="text-primary">collector.yml</span>
              <Copy text={workflowYaml} label="COPY YAML" />
            </div>
            <pre className="max-h-72 overflow-auto border-2 border-border bg-background p-2 text-[11px]">{workflowYaml}</pre>
            <div className="flex items-center justify-between gap-2 border-2 border-border p-2">
              <code className="truncate">GITHUB_TOKEN=… npx tsx scripts/collector.ts --org Mantequilla-Soft</code>
              <Copy text="GITHUB_TOKEN=… npx tsx scripts/collector.ts --org Mantequilla-Soft" />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
