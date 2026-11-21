// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readPreference } from "./useSkillViewMode";

const KEY = "skills-manager.skillViewMode";
afterEach(() => localStorage.clear());

describe("readPreference", () => {
  it("treats a stored groupBySource without the chosen flag as not chosen", () => {
    // What every existing install has: the default was written back on load.
    localStorage.setItem(KEY, JSON.stringify({ viewMode: "list", groupBySource: false }));
    expect(readPreference()).toEqual({ viewMode: "list", groupBySource: false, groupBySourceChosen: false });
  });

  it("keeps an explicit choice", () => {
    localStorage.setItem(KEY, JSON.stringify({ viewMode: "grid", groupBySource: false, groupBySourceChosen: true }));
    expect(readPreference().groupBySourceChosen).toBe(true);
  });

  it("still reads the legacy bare string", () => {
    localStorage.setItem(KEY, "list");
    expect(readPreference()).toEqual({ viewMode: "list", groupBySource: false, groupBySourceChosen: false });
  });
});
