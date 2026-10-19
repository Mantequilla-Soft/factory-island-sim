import { describe, expect, it } from "vitest";
import { FIXTURES } from "./fixture";
import { compile, creaturesAt, buildingsAt, islandRadius, toWorld, DURATION, SEA_CLEARANCE, PLATFORM } from "./sim";

describe("sea life", () => {
  for (const f of FIXTURES) {
    const c = compile(f.make());
    it(`${f.id}: boats and monsters never touch land or the factory`, () => {
      let seen = 0;
      for (let t = 0; t <= DURATION; t += 0.37) {
        const isl = c.islands.map((I) => ({ c: toWorld(I.center), R: islandRadius(buildingsAt(c, I.id, t)) }));
        for (const cr of creaturesAt(c, t)) {
          seen++;
          const p = toWorld(cr.pos);
          for (const I of isl) expect(Math.hypot(p.x - I.c.x, p.y - I.c.y)).toBeGreaterThanOrEqual(I.R + SEA_CLEARANCE - 0.01);
          expect(Math.abs(p.x) >= PLATFORM || Math.abs(p.y) >= PLATFORM).toBe(true);
        }
      }
      expect(seen).toBeGreaterThan(0);
    });
  }

  it("is deterministic: the same moment always gives the same sea", () => {
    const c = compile(FIXTURES[0].make());
    expect(creaturesAt(c, 41.3)).toEqual(creaturesAt(c, 41.3));
    expect(creaturesAt(compile(FIXTURES[0].make()), 12.7)).toEqual(creaturesAt(c, 12.7));
  });

  it("tugboats and rowboats actually move around their island", () => {
    const c = compile(FIXTURES[0].make());
    const a = creaturesAt(c, 50), b = creaturesAt(c, 58);
    const boats = a.filter((x) => x.kind !== "bug" && x.phase === "active");
    expect(boats.length).toBeGreaterThan(0);
    for (const x of boats) {
      const y = b.find((o) => o.id === x.id);
      if (y) expect(Math.hypot(x.pos.x - y.pos.x, x.pos.y - y.pos.y)).toBeGreaterThan(1);
    }
  });
});
