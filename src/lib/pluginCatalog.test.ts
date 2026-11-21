import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./tauri";
import { searchCatalog } from "./pluginCatalog";

const entry = (name: string, install_count: number | null, description = ""): CatalogEntry => ({
  plugin_id: `${name}@m`,
  name,
  description,
  marketplace: "m",
  install_count,
  installed: false,
});

const catalog = [
  entry("seo-tools", 10),
  entry("writer", 500, "Helps with SEO copy"),
  entry("superpowers", 900, "Skills for planning and TDD"),
  entry("legacy", null),
];

describe("searchCatalog", () => {
  it("lists everything by popularity when there is no query", () => {
    expect(searchCatalog(catalog, "").map((e) => e.name)).toEqual(["superpowers", "writer", "seo-tools", "legacy"]);
  });

  it("ranks name matches above description matches", () => {
    expect(searchCatalog(catalog, "seo").map((e) => e.name)).toEqual(["seo-tools", "writer"]);
  });

  it("requires every word, case-insensitively", () => {
    expect(searchCatalog(catalog, "Planning tdd").map((e) => e.name)).toEqual(["superpowers"]);
    expect(searchCatalog(catalog, "planning seo")).toEqual([]);
  });
});
