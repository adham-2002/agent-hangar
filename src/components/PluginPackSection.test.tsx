// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, mount } from "../test-utils/mount";
import { PluginPackSection } from "./PluginPackSection";
import type { PluginPack } from "../lib/pluginPacks";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o && "count" in o ? `${key}:${o.count}` : key),
  }),
}));
vi.mock("./PluginSkillSheet", () => ({ PluginSkillSheet: () => null }));

const pack = {
  plugin: {
    id: "seo@market",
    name: "seo",
    enabled: true,
    scope: "user",
    installed: true,
    files_present: true,
    install_path: "/p/seo",
    update_available: false,
  },
  detail: { skills: ["audit", "schema", "sitemap", "geo", "local"] },
  colorKey: "plugin:seo",
} as unknown as PluginPack;

const render = (grid: boolean) =>
  mount(
    <PluginPackSection
      packs={[pack]}
      colors={new Map()}
      duplicateIds={new Set()}
      pending={new Set()}
      onToggle={() => {}}
      onOpenPlugins={() => {}}
      grid={grid}
    />,
  );

afterEach(() => cleanup());

describe("PluginPackSection", () => {
  it("previews a collapsed pack's skills in the grid, then shows them as cards", async () => {
    const c = render(true);
    expect(c.textContent).toContain("audit, schema, sitemap mySkills.pluginPacks.more:2");
    await act(async () => (c.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
    const cards = [...c.querySelectorAll("ul.grid > li")].map((li) => li.textContent);
    expect(cards).toEqual(["audit", "schema", "sitemap", "geo", "local"]);
  });

  it("keeps the list view's chips and no preview", async () => {
    const c = render(false);
    expect(c.textContent).not.toContain("mySkills.pluginPacks.more");
    await act(async () => (c.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
    expect(c.querySelector("ul.grid")).toBeNull();
    expect(c.querySelectorAll("ul.flex-wrap > li")).toHaveLength(5);
  });
});
