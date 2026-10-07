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
| `VITE_SNAPSHOTS_BASE` | browser | Folder with `<org>/index.json` and `<org>/<week>.json` (default: this repo's `data` branch on raw.githubusercontent.com). The newest week loads on open. |
| `VITE_ALLOWED_SNAPSHOT_HOSTS` | browser | Extra hosts a `?snapshot=` URL may use, comma separated. |
| `VITE_SNAPSHOT_URL` | browser | Pin one snapshot file instead of the newest week. |
| `FRAME_ANCESTORS` | server | Who may frame `/embed` (CSP `frame-ancestors` list). Defaults to snapie.io. |
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

Publish this app and frame its `/embed` page. It is a chrome-less player: canvas, playback controls, and a one-line detail bar when you click a worker or island.

```html
<iframe src="https://factory.snapie.io/embed?autoplay=1" title="Butter Factory"
  width="100%" height="560" style="border:0" loading="lazy" allow="fullscreen"
  referrerpolicy="origin"></iframe>
```

`/embed` opens on the **newest published week** of the default org. It reads `<VITE_SNAPSHOTS_BASE>/<org>/index.json` at runtime, so a new weekly snapshot shows up without redeploying.

### URL parameters

| Parameter | Default | Meaning |
| --- | --- | --- |
| `org` | `VITE_DEFAULT_ORG` | Org whose snapshots to load. |
| `week` | `latest` | ISO week such as `2026-W40`, or `latest`. |
| `snapshot` | none | A full snapshot URL instead of `org`/`week`. Only https URLs on an allowed host (below) or on the app's own origin. |
| `autoplay` | `0` | `1` starts playing once loaded. Ignored when the viewer prefers reduced motion. |
| `speed` | `1` | `0.5`, `1`, `2` or `4`. |
| `controls` | `1` | `0` hides the play bar (drive it with `postMessage`). |
| `title` | `1` | `0` hides the title strip. |
| `parent` | referrer | Origin that receives events. Defaults to the framing page's origin. |
| `demo` | `0` | `1` plays the built-in sample week (no network). |

### postMessage

Events go to the framing page only, to one origin (never `*`). Commands are accepted only from the framing window.

```js
// embed -> host
window.addEventListener("message", (e) => {
  if (e.origin !== "https://factory.snapie.io" || e.data?.source !== "butter-factory") return;
  const ev = e.data.event; // { type: "ready" | "week-loaded" | "play" | "pause" | "ended" | "seek" | "select" | "error", ... }
});

// host -> embed
frame.contentWindow.postMessage({ target: "butter-factory", command: "play" }, "https://factory.snapie.io");
// commands: play | pause | seek {t: 0..75} | speed {value: 0.5|1|2|4} | week {week: "2026-W40" | "latest"}
```

### Security and framing

- `/embed` is sent with `Content-Security-Policy: frame-ancestors 'self' https://snapie.io https://*.snapie.io` and no `X-Frame-Options`. Every other page is `frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN`. To let another site embed it, set the `FRAME_ANCESTORS` server environment variable to a space-separated list (for example `'self' https://snapie.io https://app.example`). If any entry is not a plain source expression, the whole value is ignored and the default applies.
- A `?snapshot=` address is only fetched from `raw.githubusercontent.com`, `cdn.jsdelivr.net`, the app's own origin, or hosts listed in `VITE_ALLOWED_SNAPSHOT_HOSTS` (comma separated). Snapshots are validated before use, and links must be GitHub PR URLs and avatars GitHub avatar URLs.
- Pass `referrerpolicy="origin"` (or leave the default) so the app can tell who framed it. Without a referrer, set `parent` to receive events.

### In-code

The simulation (`src/sim/sim.ts`: `compile`, `stateAt`) and renderer (`src/sim/render.ts`: `draw`) are framework-light. Copy `src/sim/` into a React app, compile a validated snapshot, and call `draw(ctx, compiled, stateAt(compiled, t), …)` on a 480×300 canvas each frame.

## Snapshot schema

`schemaVersion: 1` with `repos`, `people` and `events`. Each event: `at`, `prId`, `repo`, `actor`, `type`, `itemKind`, plus optional `prUrl` (`https://github.com/{org}/{repo}/pull/{n}`) and `commitSha` (7-char merge commit, on `pr_merged`).

## Built with

TanStack Start, React, TypeScript, Tailwind CSS.
