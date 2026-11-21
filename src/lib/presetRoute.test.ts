import { describe, expect, it } from "vitest";
import { presetIdFromLocation, presetPath } from "./presetRoute";

describe("presetRoute", () => {
  it("reads the preset only from the library page", () => {
    expect(presetIdFromLocation({ pathname: "/my-skills", search: "" })).toBeNull();
    expect(presetIdFromLocation({ pathname: "/my-skills", search: "?preset=abc" })).toBe("abc");
    expect(presetIdFromLocation({ pathname: "/insights", search: "?preset=abc" })).toBeNull();
  });

  it("round-trips ids that need escaping", () => {
    const path = presetPath("a b&c");
    const [pathname, search] = path.split("?");
    expect(presetIdFromLocation({ pathname, search: `?${search}` })).toBe("a b&c");
  });
});
