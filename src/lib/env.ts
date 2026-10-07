/** Browser-visible config. VITE_* values are baked into the bundle at build time. */
export const DEFAULT_ORG: string = (import.meta.env["VITE_DEFAULT_ORG"] as string | undefined)?.trim() || "Mantequilla-Soft";
export const SNAPSHOT_URL: string = (import.meta.env["VITE_SNAPSHOT_URL"] as string | undefined)?.trim() || "";
/**
 * Only honoured in local dev: a VITE_ token would be readable by anyone in a published bundle.
 */
export const DEV_GITHUB_TOKEN: string = import.meta.env.DEV ? ((import.meta.env["VITE_GITHUB_TOKEN"] as string | undefined)?.trim() || "") : "";

/** prUrl -> commit URL for a short hash. */
export const commitUrl = (prUrl: string, sha: string) => prUrl.replace(/\/pull\/\d+$/, `/commit/${sha}`);
export const prNumber = (prUrl: string) => prUrl.split("/").pop() ?? "";
