# Butter Factory

An isometric pixel-art factory that replays a GitHub org's week of pull requests: workers fabricate items, queue at repo island docks, get stamped by Snapie on approval, and grow the islands when merged.

## Quick start

```sh
git clone <this-repository-url>
cd butter-factory
pnpm install        # or: npm install
cp .env.example .env.local
pnpm dev            # or: npm run dev  → http://localhost:8080
```

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_DEFAULT_ORG` | browser | Org pre-filled in the collector dialog (default `Mantequilla-Soft`). |
| `VITE_GITHUB_TOKEN` | browser, **dev only** | Pre-fills the collector token. Ignored in production builds, since `VITE_*` values are public in the bundle. |
| `VITE_SNAPSHOT_URL` | browser | Snapshot JSON loaded automatically on page open. |
| `GITHUB_TOKEN` | Node | Token for `scripts/collector.ts`. |

## Creating a read-only GitHub token

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token.
2. Resource owner: your org (the org may need to approve fine-grained tokens).
3. Repository access: *All repositories* (or the ones you want on the map).
4. Permissions → Repository: **Pull requests: Read-only**, **Metadata: Read-only**. Nothing else.
5. Copy the token. Without a token GitHub allows 60 requests/hour and public repos only; with one, 5,000/hour, plus ready-for-review timing and merge commit hashes.

## Running the collector locally

```sh
GITHUB_TOKEN=github_pat_… npx tsx scripts/collector.ts --org Mantequilla-Soft \
  [--week 2026-W40] [--out snapshots] [--private anonymize|exclude|include]
```

Writes `snapshots/<org>/<week>.json` and updates `snapshots/<org>/index.json`. Defaults to the last complete ISO week. Load the file in the app by dropping it on the map or with "Load URL".

Privacy: titles are read only to derive the item kind and then discarded; bodies and branch names are never read. Private repos are shown as "Mystery Island" by default and get no PR links or commit hashes.

## Weekly GitHub Actions workflow

1. Copy `scripts/collector.ts`, `src/collector/core.ts`, `src/sim/types.ts`, `src/sim/validate.ts` and `.github/workflows/collector.yml` into a repo.
2. Add the token above as the repo secret `COLLECTOR_TOKEN`.
3. Optionally set repo variables `BUTTER_ORG` and `BUTTER_PRIVATE_REPOS`.
4. The workflow runs every Monday 01:15 UTC and from Actions → "Run workflow". Snapshots are committed to the `data` branch.
5. Point the app at a week: `VITE_SNAPSHOT_URL=https://raw.githubusercontent.com/<owner>/<repo>/data/snapshots/<org>/<week>.json`.

## Embedding in a host app (e.g. snapie.io)

- **iframe:** publish this app and embed it:
  ```html
  <iframe src="https://<your-butter-factory-url>/" width="100%" height="820" style="border:0" loading="lazy"></iframe>
  ```
  Build it with `VITE_SNAPSHOT_URL` set so it opens on your latest week.
- **In-code:** the simulation (`src/sim/sim.ts`: `compile`, `stateAt`) and renderer (`src/sim/render.ts`: `draw`) are framework-light. Copy `src/sim/` into a React app, compile a validated snapshot, and call `draw(ctx, compiled, stateAt(compiled, t), …)` on a 480×300 canvas each frame.

## Snapshot schema

`schemaVersion: 1` with `repos`, `people` and `events`. Each event: `at`, `prId`, `repo`, `actor`, `type`, `itemKind`, plus optional `prUrl` (`https://github.com/{org}/{repo}/pull/{n}`) and `commitSha` (7-char merge commit, on `pr_merged`).

## Built with

TanStack Start, React, TypeScript, Tailwind CSS.
