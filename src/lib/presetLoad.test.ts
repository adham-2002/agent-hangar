import { describe, expect, it } from "vitest";
import { presetLoad } from "./presetLoad";

describe("presetLoad", () => {
  it("bands a preset by what it adds to every session", () => {
    expect(presetLoad(0)).toBe("light");
    expect(presetLoad(1_499)).toBe("light");
    expect(presetLoad(1_500)).toBe("medium");
    expect(presetLoad(4_000)).toBe("heavy");
  });
});
