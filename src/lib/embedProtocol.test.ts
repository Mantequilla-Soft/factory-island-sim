import { describe, expect, it, vi } from "vitest";
import { DURATION } from "@/sim/sim";
import { EMBED_SOURCE, emit, parentOrigin, parseCommand } from "@/lib/embedProtocol";

const cmd = (extra: Record<string, unknown>) => ({ target: EMBED_SOURCE, ...extra });

describe("parseCommand", () => {
  it("accepts the supported commands", () => {
    expect(parseCommand(cmd({ command: "play" }))).toEqual({ command: "play" });
    expect(parseCommand(cmd({ command: "pause" }))).toEqual({ command: "pause" });
    expect(parseCommand(cmd({ command: "speed", value: 2 }))).toEqual({
      command: "speed",
      value: 2,
    });
    expect(parseCommand(cmd({ command: "week", week: "2026-W40" }))).toEqual({
      command: "week",
      week: "2026-W40",
    });
    expect(parseCommand(cmd({ command: "week", week: "latest" }))).toEqual({
      command: "week",
      week: "latest",
    });
  });
  it("clamps seek to the playback range", () => {
    expect(parseCommand(cmd({ command: "seek", t: -5 }))).toEqual({ command: "seek", t: 0 });
    expect(parseCommand(cmd({ command: "seek", t: 9999 }))).toEqual({
      command: "seek",
      t: DURATION,
    });
    expect(parseCommand(cmd({ command: "seek", t: 10 }))).toEqual({ command: "seek", t: 10 });
  });
  it("ignores anything malformed or addressed elsewhere", () => {
    for (const bad of [
      null,
      undefined,
      "play",
      3,
      {},
      { command: "play" },
      { target: "other", command: "play" },
      cmd({ command: "explode" }),
      cmd({ command: "seek", t: "3" }),
      cmd({ command: "seek", t: NaN }),
      cmd({ command: "speed", value: 3 }),
      cmd({ command: "speed", value: "2" }),
      cmd({ command: "week", week: "../../x" }),
      cmd({ command: "week" }),
      cmd({ command: 5 }),
    ]) {
      expect(parseCommand(bad)).toBeNull();
    }
  });
});

describe("parentOrigin", () => {
  it("prefers an explicit ?parent= and falls back to the referrer", () => {
    expect(parentOrigin("https://snapie.io/factory", "https://other.example/")).toBe(
      "https://snapie.io",
    );
    expect(parentOrigin(undefined, "https://snapie.io/factory?x=1")).toBe("https://snapie.io");
  });
  it("allows http only for localhost, and returns null when nobody is known", () => {
    expect(parentOrigin(undefined, "http://localhost:3000/a")).toBe("http://localhost:3000");
    expect(parentOrigin(undefined, "http://evil.example/")).toBeNull();
    expect(parentOrigin("javascript:alert(1)", "")).toBeNull();
    expect(parentOrigin(undefined, "")).toBeNull();
  });
});

describe("emit", () => {
  it("posts to the chosen origin, never to *, and stays quiet without a known parent", () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    emit({ type: "ready" }, target, "https://snapie.io");
    expect(postMessage).toHaveBeenCalledWith(
      { source: EMBED_SOURCE, event: { type: "ready" } },
      "https://snapie.io",
    );
    emit({ type: "play" }, target, null);
    emit({ type: "play" }, null, "https://snapie.io");
    expect(postMessage).toHaveBeenCalledTimes(1);
  });
});
