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
