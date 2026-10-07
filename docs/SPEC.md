> **Status: original design draft.** This was written before the app existed. The app that was built
> follows the same snapshot schema (section 7) and the same world mapping (section 5), but the layout
> and packaging differ: it is a single TanStack Start app with `src/collector` (also run by
> `scripts/collector.ts` and the GitHub Action) and `src/sim` (pure simulation and canvas renderer),
> not the `packages/` split in section 4, and it is consumed by embedding the deployed app in an
> iframe rather than as an npm SDK (sections 10 and 11). See the README for how it works today.
> Open questions in section 15 are partly settled: private repos are anonymized by default, snapshots
> live on a `data` branch, and a week is an ISO week in UTC.

# The Butter Factory — Spec (draft 1)

An animated, replayable pixel-art world that turns an organization's GitHub activity into a living
factory-and-islands sim. Built as its own repo and consumed by snapie.io (issue #158 in
`Mantequilla-Soft/snapie-io`) as a self-contained SDK, the same way the Snapie games are.

Status: draft for discussion. Nothing here is built yet.

---

## 1. Idea in one paragraph

Each repository is an **island**. Contributors are small **workers** at a central **factory**. When a
pull request is opened, a worker starts fabricating an item (a bolt, a nut, a gear...). When the PR is
ready for review the worker carries the item to the repo's island and **queues at the dock**. A reviewer
walks over and **stamps** it. When it merges, the worker **drops the item on the island** (which grows)
and walks back to the factory. Visitors can watch the live week or **replay** any past week with
play/pause/speed/scrub controls. The point: make ongoing work visible, funny and easy to read.

## 2. Goals and non-goals

Goals
- Make a week of org activity understandable at a glance and fun to watch.
- Deterministic replay: the same event data always renders the same week.
- Embeddable: snapie.io mounts it with a few lines; anyone else can mount it for their own org.
- Safe by default: private repos are never exposed unless explicitly allowed.
- Runs smoothly on a mid-range phone.

Non-goals (v1)
- Real-time websockets / live streaming. A refresh every few minutes is enough.
- Showing code, diffs, commit messages or PR bodies.
- Per-commit animation. PRs and reviews are the story; commits are optional later.
- A level editor or user-customizable maps.

## 3. Name and repo

- Name: **Butter Factory** (Mantequilla = butter). Repo: `Mantequilla-Soft/butter-factory`.
- License: decide before first public commit (MIT is the obvious default for an "example to set").

## 4. Repo layout

```
butter-factory/
  packages/
    core/        # pure TypeScript: event types, simulation, no DOM, no network
    renderer/    # Canvas 2D renderer + asset loader + input (timeline, speed)
    sdk/         # React component + mountButterFactory(el, options)  [published to npm]
    collector/   # CLI + GitHub Action: pulls GitHub data -> weekly JSON snapshots
  apps/
    demo/        # standalone Vite site, deployable to GitHub Pages
  data/
    fixtures/    # frozen sample weeks for tests and the demo
  SPEC.md
```

Rule (borrowed from the Snapie Game Blueprint): `core` and `renderer` import nothing from any host
site; the SDK is the only surface a host touches.

## 5. Concept mapping (GitHub -> world)

| GitHub fact | World representation |
| --- | --- |
| Repository | Island. Size and number of buildings grow with merged PRs (cumulative, capped). |
| Pull request (open / draft) | Worker fabricates an item at a factory workstation. |
| PR type (title prefix) | Item kind: `feat` gear, `fix` bolt, `perf` spring, `docs` scroll, `chore`/other nut, `test` gauge. |
| Ready for review / review requested | Worker carries the finished item to the island dock and joins the queue. |
| Review: changes requested | Worker walks the item back to the factory for rework. |
| Review: approved | Reviewer walks to the dock and stamps the item. |
| Merged | Worker drops the item on the island, a building appears, worker returns to the factory. |
| Closed without merge | Item falls into the sea or goes to the scrap heap. |
| Bot PRs (dependabot) | Robot worker delivering crates. |
| Issue opened / closed | Optional v2: message-in-a-bottle / small boat. |

Item kind falls back to a plain nut when the title has no recognizable prefix.

## 6. Architecture

```
GitHub API --collector--> weekly snapshot JSON (public URL) --sdk--> browser
                                  |
                           (core simulation: pure function of events and time t)
```

1. **Collector** (runs on a schedule in GitHub Actions in this repo or the org): reads PRs, reviews and
   timeline events for the configured org, applies the privacy filter, and writes snapshots.
2. **Snapshot hosting:** committed to a `data` branch or attached to a release, served as static files
   (GitHub Pages / raw CDN). No server is needed in the host app, and the browser never talks to GitHub.
3. **SDK** fetches a snapshot, hands events to `core`, and `renderer` draws the result.

Why a static snapshot instead of an API route in snapie-io: no GitHub rate limits at request time, no
token in the host app, and the same data works for the standalone demo and for other orgs.

## 7. Data contract

Snapshot file: `snapshots/<org>/<ISO-week>.json` plus `snapshots/<org>/index.json` listing weeks.

```ts
export type Snapshot = {
  schemaVersion: 1;
  org: string;
  weekStart: string;          // ISO date, Monday 00:00 UTC
  weekEnd: string;
  generatedAt: string;
  repos: RepoInfo[];
  people: Person[];
  events: ActivityEvent[];    // sorted by `at`
};

export type RepoInfo = {
  id: string;                 // stable slug used by events
  name: string;               // display name; "Mystery Island" if anonymized
  anonymized: boolean;
  mergedTotal: number;        // cumulative merged PRs before weekStart, for island size
};

export type Person = {
  id: string;                 // github login
  displayName?: string;
  avatarUrl?: string;
  hiveAccount?: string;       // optional mapping
  isBot: boolean;
};

export type ActivityEvent = {
  at: string;                 // ISO timestamp
  prId: string;               // "<repoId>#<number>"
  repo: string;               // RepoInfo.id
  actor: string;              // Person.id
  type:
    | 'pr_opened'
    | 'pr_ready_for_review'
    | 'review_changes_requested'
    | 'review_approved'
    | 'pr_merged'
    | 'pr_closed';
  itemKind: 'gear' | 'bolt' | 'spring' | 'scroll' | 'nut' | 'gauge' | 'crate';
};
```

No titles, bodies, branch names or diffs are ever written to a snapshot. Only the derived `itemKind`.

## 8. Simulation (core)

- Pure function: `stateAt(snapshot, t) -> WorldState`. No hidden mutable state, so scrubbing and seeking
  are exact and a replay is identical every time.
- Workers have a small state machine: `idle -> fabricating -> carrying -> queued -> stamped -> delivering -> returning`.
  Movement is interpolated along precomputed paths between fixed points (workstation, dock, island).
- Time compression: a week plays in a target of 60 to 90 seconds. Quiet stretches (nights/weekends) are
  compressed more than busy ones. The speed control multiplies on top of that.
- Queue rules: one stamp at a time per island, FIFO, minimum on-screen dwell time per stage so fast
  merges are still visible.
- Crowd limits: at most N visible workers; extras stack as a badge ("+3") rather than drawing everyone.
- Seeded randomness (seed derived from the PR id) for idle animations, so it is still deterministic.

## 9. Rendering and art (renderer)

- Canvas 2D at a low internal resolution (about 320x192 like the Snapie games), integer-scaled with
  nearest-neighbour, using the Snapie palette: `#1a1c2c`, `#f4f4f4`, `#ef7d57`, `#38b764`, cyan accents.
- Top-down or light isometric map: central factory, islands arranged around it, causeways or boats optional.
- Snapie (cyborg bee) appears as the inspector who stamps approvals.
- Sprites: simple 4-direction walk cycles for 4 to 6 body types; avatar heads drawn from the person's
  avatar image, downscaled to 8x8, with a fallback head color derived from the login.
- Camera: fixed view in v1, with tap/click on an island to focus it and show repo name, merged count and
  recent items.
- Accessibility: a text "activity feed" panel mirrors what is on screen; reduced-motion mode shows a
  static weekly summary instead of the animation.
- Assets are loaded from the package, never from third-party hosts, except avatar images, which go through
  the host's image proxy when one is provided (see 10).

## 10. SDK API

Follows the Snapie Game Blueprint shape so snapie-io can consume it like a game.

```ts
export type ButterFactoryOptions = {
  org?: string;                       // default from snapshot
  snapshotUrl: string;                // base URL of the static snapshots
  week?: string | 'latest';           // ISO week, default 'latest'
  autoPlay?: boolean;
  speed?: 0.5 | 1 | 2 | 4;
  showControls?: boolean;             // false = host draws its own timeline
  reducedMotion?: boolean | 'auto';
  resolveAvatarUrl?: (url: string) => string;   // host can route through its image proxy
  maxWidth?: number;
  onEvent?: (e: ButterFactoryEvent) => void;
};

export type ButterFactoryEvent =
  | { type: 'ready' }
  | { type: 'week-loaded'; week: string; prCount: number }
  | { type: 'play' } | { type: 'pause' }
  | { type: 'seek'; t: number }
  | { type: 'island-selected'; repo: string };

export type ButterFactoryControls = {
  play(): void; pause(): void; seek(t: number): void;
  setWeek(week: string): Promise<void>; setSpeed(s: number): void;
  destroy(): void;
};
```

React: `<ButterFactory snapshotUrl={...} autoPlay />`. Anything else: `mountButterFactory(el, options)`.

## 11. Integration in snapie-io

- Add `butter-factory` as a dependency (npm, pinned). Games are vendored copies; this is intentionally
  different because the factory has its own release cadence and a data pipeline. ButrAuth already sets the
  precedent for an npm-consumed package.
- New route, e.g. `/factory` (or a section on About), a thin client page that mounts the SDK with
  `snapshotUrl` pointing at the hosted snapshots and `resolveAvatarUrl` set to our `/api/image-proxy`.
- Optional: link contributors to their Hive profile when `hiveAccount` is present.
- No server code in snapie-io, no GitHub token in snapie-io, no new DB tables.

## 12. Privacy and safety

- **Private repos are excluded by default.** The collector config has an explicit allowlist and an
  `anonymizePrivate` option that maps private repos to "Mystery Island" with no name or link.
- Snapshots contain no titles, branches, bodies, diffs, emails, or commit messages.
- Public contributors only show what is already public on GitHub. Provide an opt-out list of logins that
  render as an anonymous worker.
- Collector uses a fine-grained read-only token stored as an Actions secret; it never ships to clients.
- Avatar fetches go through the host's proxy when provided, so the host's SSRF protections apply.

## 13. Performance and quality

- Budget: 60 fps on a mid-range phone, under 250 KB of JS (gzipped) for the SDK, snapshots under 200 KB.
- Pause when the tab is hidden or the canvas is off-screen; no wake lock.
- Tests: unit tests for `core` against frozen fixtures (state at known timestamps), schema validation for
  snapshots, a collector test with recorded GitHub responses, and a visual smoke test in the demo.
- Determinism test: render the same fixture twice and compare frame hashes at fixed times.

## 14. Milestones

1. **M0 (prototype):** `core` + minimal renderer on one fixture week: 3 islands, one factory, coloured
   boxes for workers, timeline slider. Proves the replay model.
2. **M1:** collector + GitHub Action producing real weekly snapshots for `Mantequilla-Soft`; demo site on
   Pages; privacy filter in place.
3. **M2:** real pixel art, item kinds, stamping inspector, island growth, crowd limits.
4. **M3:** SDK package published, snapie-io `/factory` page, accessibility panel, reduced-motion mode.
5. **M4 (nice to have):** issues as bottles/boats, "this week in numbers" summary, share a link to a
   specific week and timestamp, other orgs' configs.

## 15. Open questions

1. Private repos: omit entirely, or "Mystery Island"? (Default in this spec: omit, configurable.)
2. License and whether the collector Action is meant to be reused by other orgs from day one.
3. Where snapshots live: `data` branch vs releases vs a small bucket. (Default: `data` branch + Pages.)
4. Contributor mapping to Hive accounts: who maintains the file, and is it opt-in per person?
5. Art: who draws the sprites, or do we start with a generated placeholder set and commission later?
6. Do we show reviewers who are not authors as their own workers, or just the Snapie inspector?
7. Time zone for "a week": UTC Monday, or the maintainers' local time?

## 16. Risks

- Art effort dominates the schedule; mitigate by shipping M1 with placeholder art.
- Visual clutter on busy weeks; mitigate with crowd limits and compression rules (section 8).
- GitHub API quotas for the collector on large orgs; mitigate with incremental snapshots and conditional requests.
- Scope creep into a general GitHub visualizer; keep v1 to PRs and reviews.
