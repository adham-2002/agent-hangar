import { describe, expect, it } from "vitest";

// The app is called Agent Hangar. Commits picked from the original project
// (see docs/UPSTREAM.md) still say "Skills Manager", so a picked commit that
// adds such a string would show the old name to users. Internal names
// (`skills-manager-cli`, `~/.skills-manager`) are deliberately unchanged and
// are not matched here.
const OLD_NAME = /Skills Manager/;

const visible = import.meta.glob<string>(["/src/i18n/*.json", "/index.html"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("app name", () => {
  it("reads the locale files", () => {
    expect(Object.keys(visible).length).toBeGreaterThanOrEqual(5);
  });

  it("never shows the old name to users", () => {
    const bad = Object.entries(visible)
      .filter(([, text]) => OLD_NAME.test(text))
      .map(([path]) => path);
    expect(bad).toEqual([]);
  });
});
