import { describe, expect, it } from "vitest";
import { treemap } from "./treemap";

const values = [600, 300, 200, 100, 50, 30, 10];

describe("treemap", () => {
  it("fills the box with areas proportional to the values", () => {
    const rects = treemap(values, (v) => v, 400, 300);
    expect(rects).toHaveLength(values.length);
    const total = values.reduce((n, v) => n + v, 0);
    for (const r of rects) {
      expect(r.w * r.h).toBeCloseTo((r.item / total) * 400 * 300, 3);
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(400 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(300 + 1e-6);
    }
    const covered = rects.reduce((n, r) => n + r.w * r.h, 0);
    expect(covered).toBeCloseTo(400 * 300, 3);
  });

  it("puts the largest first and keeps it near square", () => {
    const [first] = treemap(values, (v) => v, 400, 300);
    expect(first.item).toBe(600);
    expect(Math.max(first.w / first.h, first.h / first.w)).toBeLessThan(2.5);
  });

  it("skips zero values and handles an empty or degenerate box", () => {
    expect(treemap([0, 0], (v) => v, 100, 100)).toEqual([]);
    expect(treemap([5], (v) => v, 0, 100)).toEqual([]);
    expect(treemap([5, 0], (v) => v, 100, 50)).toHaveLength(1);
  });
});
