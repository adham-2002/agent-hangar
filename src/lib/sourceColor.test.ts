import { describe, expect, it } from "vitest";
import { SOURCE_PALETTE, assignSourceColors } from "./sourceColor";

const keys = (n: number) => Array.from({ length: n }, (_, i) => `repo:github.com/owner/pack-${i}`);

describe("assignSourceColors", () => {
  it("gives the same source the same colour every time", () => {
    const a = assignSourceColors(["repo:github.com/obra/superpowers", "repo:github.com/rtk-ai/rtk"]);
    const b = assignSourceColors(["repo:github.com/rtk-ai/rtk", "repo:github.com/obra/superpowers"]);
    expect(a).toEqual(b);
  });

  it("never repeats a colour while there are no more sources than colours", () => {
    const colors = assignSourceColors(keys(SOURCE_PALETTE.length));
    expect(new Set(colors.values()).size).toBe(SOURCE_PALETTE.length);
  });

  it("still colours every source past the palette size", () => {
    const colors = assignSourceColors(keys(SOURCE_PALETTE.length + 3));
    expect(colors.size).toBe(SOURCE_PALETTE.length + 3);
  });

  it("leaves the unknown bucket uncoloured and ignores duplicates", () => {
    const colors = assignSourceColors(["unknown", "site:example.com", "site:example.com"]);
    expect(colors.has("unknown")).toBe(false);
    expect(colors.size).toBe(1);
  });
});
