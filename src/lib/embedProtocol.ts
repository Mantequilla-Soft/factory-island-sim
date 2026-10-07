import { DURATION } from "@/sim/sim";
import { isWeek } from "@/lib/snapshotSource";

/**
 * postMessage contract between the embedded factory and the page that frames it.
 * Same shape as the Snapie games' iframe protocol.
 *
 *   embed -> host   { source: "butter-factory", event: EmbedEvent }
 *   host  -> embed  { target: "butter-factory", command: "play" | "pause" | "seek" | "speed" | "week", ... }
 */
export const EMBED_SOURCE = "butter-factory";
export const SPEEDS = [0.5, 1, 2, 4] as const;

export type EmbedEvent =
  | { type: "ready" }
  | { type: "week-loaded"; org: string; weekStart: string; events: number; repos: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "ended" }
  | { type: "seek"; t: number }
  | { type: "select"; kind: "worker" | "island"; id: string }
  | { type: "error"; message: string };

export type EmbedCommand =
  | { command: "play" }
  | { command: "pause" }
  | { command: "seek"; t: number }
  | { command: "speed"; value: (typeof SPEEDS)[number] }
  | { command: "week"; week: string };

/** Validates an incoming message. Anything unexpected returns null and is ignored. */
export function parseCommand(data: unknown): EmbedCommand | null {
  if (!data || typeof data !== "object") return null;
  const d = data as {
    target?: unknown;
    command?: unknown;
    t?: unknown;
    value?: unknown;
    week?: unknown;
  };
  if (d.target !== EMBED_SOURCE || typeof d.command !== "string") return null;
  switch (d.command) {
    case "play":
    case "pause":
      return { command: d.command };
    case "seek":
      return typeof d.t === "number" && Number.isFinite(d.t)
        ? { command: "seek", t: Math.min(DURATION, Math.max(0, d.t)) }
        : null;
    case "speed": {
      const v = SPEEDS.find((s) => s === d.value);
      return v ? { command: "speed", value: v } : null;
    }
    case "week":
      return typeof d.week === "string" && isWeek(d.week)
        ? { command: "week", week: d.week }
        : null;
    default:
      return null;
  }
}

/**
 * Origin events are posted to. An explicit `?parent=` wins, then the page that
 * framed us (document.referrer). Null means "don't post": nobody known is listening.
 * Events only carry public activity data, but they still go to one origin, never "*".
 */
export function parentOrigin(parentParam: string | undefined, referrer: string): string | null {
  for (const raw of [parentParam, referrer]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (
        u.protocol === "https:" ||
        (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))
      )
        return u.origin;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export function emit(event: EmbedEvent, target: Window | null, origin: string | null): void {
  if (!target || !origin) return;
  target.postMessage({ source: EMBED_SOURCE, event }, origin);
}
