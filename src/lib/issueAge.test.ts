import { describe, expect, it } from "vitest";
import { floating } from "./issueAge";

const D = 86_400_000;
describe("issue floating time", () => {
  const openedAt = "2026-09-14T10:00:00Z";
  it("counts whole days once past two days", () => {
    expect(floating({ openedAt }, Date.parse(openedAt) + 14 * D + 5000)).toBe("for 14 days");
  });
  it("counts hours under two days", () => {
    expect(floating({ openedAt }, Date.parse(openedAt) + 5 * 3_600_000)).toBe("for 5 hours");
  });
  it("stops the clock when the issue was closed", () => {
    const closedAt = new Date(Date.parse(openedAt) + 3 * D).toISOString();
    expect(floating({ openedAt, closedAt }, Date.parse(openedAt) + 10 * D)).toBe("3 days (closed)");
  });
});
