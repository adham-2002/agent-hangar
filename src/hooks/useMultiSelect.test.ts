import { describe, expect, it } from "vitest";
import { groupSelectionState, toggleKeys } from "./useMultiSelect";

describe("toggleKeys", () => {
  it("adds a whole group and keeps other selections", () => {
    const next = toggleKeys(new Set(["other"]), ["a", "b"]);
    expect([...next].sort()).toEqual(["a", "b", "other"]);
  });

  it("completes a partly selected group instead of clearing it", () => {
    const next = toggleKeys(new Set(["a"]), ["a", "b"]);
    expect([...next].sort()).toEqual(["a", "b"]);
  });

  it("clears a fully selected group but leaves other groups", () => {
    const next = toggleKeys(new Set(["a", "b", "other"]), ["a", "b"]);
    expect([...next]).toEqual(["other"]);
  });
});

describe("groupSelectionState", () => {
  it("reports none, some and all", () => {
    expect(groupSelectionState(new Set(), ["a", "b"])).toBe("none");
    expect(groupSelectionState(new Set(["a"]), ["a", "b"])).toBe("some");
    expect(groupSelectionState(new Set(["a", "b", "x"]), ["a", "b"])).toBe("all");
  });
});
