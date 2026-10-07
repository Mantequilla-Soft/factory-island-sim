import { describe, expect, it } from "vitest";
import { FIXTURES } from "@/sim/fixture";
import { validateSnapshot } from "@/sim/validate";

const base = () => JSON.parse(JSON.stringify(FIXTURES[0]!.make()));

describe("validateSnapshot people.avatarUrl", () => {
  it("accepts GitHub avatar URLs", () => {
    for (const url of [
      "https://avatars.githubusercontent.com/u/1?v=4",
      "https://github.com/octocat.png",
    ]) {
      const s = base();
      s.people[0].avatarUrl = url;
      expect(() => validateSnapshot(s)).not.toThrow();
    }
  });
  it("rejects any other host or scheme, since every viewer's browser would load it", () => {
    for (const url of [
      "https://tracker.example/pixel.gif",
      "http://avatars.githubusercontent.com/u/1",
      "javascript:alert(1)",
      "data:image/svg+xml,<svg/>",
      42,
    ]) {
      const s = base();
      s.people[0].avatarUrl = url;
      expect(() => validateSnapshot(s)).toThrow(/avatarUrl/);
    }
  });
  it("still allows a snapshot with no avatars", () => {
    expect(() => validateSnapshot(base())).not.toThrow();
  });
});
