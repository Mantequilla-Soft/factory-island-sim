<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Collector logic lives in src/collector/core.ts with relative imports only, shared by the in-app collector and scripts/collector.ts, so browser and GitHub Action produce identical snapshots.
- Simulation (src/sim) is pure: stateAt(compiled, t) has no hidden state, so scrubbing/replay are exact.
- Issues live in an optional Snapshot.issues array (not events), so older schemaVersion 1 snapshots still load; sea-life positions come from creaturesAt() inside stateAt to keep scrubbing exact.
- Ripples, honks and the island-zoom camera are UI-only (wall-clock, src/hooks/use-world-canvas.ts drawing the scene offscreen then blitting through the camera); they never touch src/sim, so replay stays exact.
- Sea life must stay in open water: creature positions are pushed outside every island's live radius plus SEA_CLEARANCE and off the factory platform inside sim.ts (covered by src/sim/sim.test.ts).
