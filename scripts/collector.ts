#!/usr/bin/env -S npx tsx
/**
 * Butter Factory collector CLI.
 *
 *   GITHUB_TOKEN=ghp_... npx tsx scripts/collector.ts --org Mantequilla-Soft [--week 2026-W40] [--out snapshots] [--private anonymize|exclude|include]
 *
 * Writes snapshots/<org>/<ISO-week>.json and updates snapshots/<org>/index.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collect, lastCompleteWeek, type PrivateRepoMode } from "../src/collector/core";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const org = arg("org", process.env["BUTTER_ORG"]);
  if (!org) throw new Error("Pass --org <name> or set BUTTER_ORG.");
  const week = arg("week") || lastCompleteWeek();
  const out = arg("out", "snapshots")!;
  const privateRepos = (arg("private", process.env["BUTTER_PRIVATE_REPOS"] ?? "anonymize") as PrivateRepoMode);
  if (!["anonymize", "exclude", "include"].includes(privateRepos)) throw new Error("--private must be anonymize, exclude or include.");
  const token = process.env["GITHUB_TOKEN"] || undefined;

  const { snapshot, stats } = await collect({ org, week, token, privateRepos, maxPrs: 1000, onProgress: (m) => console.log(m) });
  const dir = join(out, org);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${week}.json`), JSON.stringify(snapshot, null, 2) + "\n");

  const indexPath = join(dir, "index.json");
  let weeks: string[] = [];
  try { weeks = (JSON.parse(await readFile(indexPath, "utf8")) as { weeks?: string[] }).weeks ?? []; } catch { /* first run */ }
  weeks = [...new Set([...weeks, week])].sort();
  await writeFile(indexPath, JSON.stringify({ org, latest: weeks[weeks.length - 1], weeks, updatedAt: new Date().toISOString() }, null, 2) + "\n");

  console.log(`Wrote ${join(dir, `${week}.json`)} — ${stats.prs} PRs, ${snapshot.events.length} events${stats.truncated ? " (truncated)" : ""}.`);
}

main().catch((e) => { console.error(`collector failed: ${(e as Error).message}`); process.exit(1); });
