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
  it("shows a plugin as one card listing its first skills, then all of them", async () => {
    const c = render(true);
    const rows = () => [...c.querySelectorAll("li li")].map((li) => li.textContent);
    expect(rows()).toEqual(["audit", "schema", "sitemap", "geo", "local"]);
    expect(c.textContent).not.toContain("mySkills.packCard.more");
  });

  it("keeps the list view's chips and no preview", async () => {
    const c = render(false);
    expect(c.querySelector("li li")).toBeNull();
    await act(async () => (c.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
    expect(c.querySelector("ul.grid")).toBeNull();
    expect(c.querySelectorAll("ul.flex-wrap > li")).toHaveLength(5);
  });
});
