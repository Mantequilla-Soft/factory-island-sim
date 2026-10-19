import { describe, expect, it } from "vitest";
import { zoomAround, ZOOM_MAX, ZOOM_MIN } from "./use-world-canvas";
import { CAM_HOME, RW, RH, viewToBase } from "@/sim/render";

describe("map zoom", () => {
  it("never zooms past 5x or out beyond the whole map (1x)", () => {
    expect(ZOOM_MAX).toBe(5);
    expect(ZOOM_MIN).toBe(1);
    expect(zoomAround(CAM_HOME, 50).z).toBe(5);
    expect(zoomAround(CAM_HOME, 0.2)).toEqual(CAM_HOME);
  });

  it("keeps the point under the cursor in place while zooming", () => {
    const ax = RW * 0.6, ay = RH * 0.55;
    const before = viewToBase(CAM_HOME, ax, ay);
    const after = viewToBase(zoomAround(CAM_HOME, 2, ax, ay), ax, ay);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("the + button zooms around the middle of the map", () => {
    const c = zoomAround(CAM_HOME, 1.5);
    expect(c.x).toBeCloseTo(RW / 2, 6);
    expect(c.y).toBeCloseTo(RH / 2, 6);
  });
});
