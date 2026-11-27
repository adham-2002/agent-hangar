import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { activeFilterChips } from "./filterChips";
import { UNTAGGED_FILTER } from "./skillTags";

const t = ((key: string) => key) as unknown as TFunction;

describe("activeFilterChips", () => {
  it("lists channel, source and tag filters with readable labels", () => {
    const chips = activeFilterChips({
      channels: new Set(["git"]),
      sources: new Set(["repo:o/pack", "repo:gone"]),
      tags: new Set(["flutter", UNTAGGED_FILTER]),
      sourceOptions: [{ key: "repo:o/pack", label: "o/pack", count: 3 }],
      t,
    });
    expect(chips.map((c) => [c.kind, c.label])).toEqual([
      ["channel", "mySkills.sourceFilter.git"],
      ["source", "o/pack"],
      ["source", "repo:gone"],
      ["tag", "flutter"],
      ["tag", "mySkills.tags.untagged"],
    ]);
  });
});
