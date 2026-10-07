export type ItemKind = "gear" | "bolt" | "spring" | "scroll" | "nut" | "gauge" | "crate";
export type EventType =
  | "pr_opened"
  | "pr_ready_for_review"
  | "review_changes_requested"
  | "review_approved"
  | "pr_merged"
  | "pr_closed";

export type RepoInfo = { id: string; name: string; anonymized: boolean; mergedTotal: number };
export type Person = { id: string; displayName?: string; avatarUrl?: string; hiveAccount?: string; isBot: boolean };
/** prUrl / commitSha are optional and omitted for anonymized repos. commitSha is the 7-char merge commit. */
export type ActivityEvent = { at: string; prId: string; repo: string; actor: string; type: EventType; itemKind: ItemKind; prUrl?: string; commitSha?: string };

export type Snapshot = {
  schemaVersion: 1;
  org: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  repos: RepoInfo[];
  people: Person[];
  events: ActivityEvent[];
};
