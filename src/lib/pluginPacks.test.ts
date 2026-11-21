import { describe, expect, it } from "vitest";
import type { ManagedSkill, PluginDetail, PluginInfo } from "./tauri";
import { buildSourceGroups } from "./skillSource";
import { findDuplicatePacks, pluginPacks } from "./pluginPacks";

const skill = (name: string, tools: string[], ref = "agricidaniel/claude-seo/" + name): ManagedSkill =>
  ({
    id: name,
    name,
    source_type: "skillssh",
    source_ref: ref,
    source_ref_resolved: null,
    central_path: `/lib/${name}`,
    targets: tools.map((tool) => ({ tool })),
  }) as unknown as ManagedSkill;

const plugin = (over: Partial<PluginInfo> = {}): PluginInfo => ({
  id: "claude-seo@agricidaniel-claude-seo",
  name: "claude-seo",
  marketplace: "agricidaniel-claude-seo",
  version: "2.6.2",
  scope: "user",
  enabled: true,
  install_path: "/p",
  installed: true,
  files_present: true,
  latest_version: null,
  update_available: false,
  source_repo: "https://github.com/AgriciDaniel/claude-seo",
  ...over,
});

const detail = (skills: string[]): PluginDetail => ({
  description: null, author: null, skills, commands: [], agents: [], hooks: false, mcp_servers: [],
});

const run = (skills: ManagedSkill[], p: PluginInfo, d: PluginDetail | undefined) =>
  findDuplicatePacks(buildSourceGroups(skills), pluginPacks([p], d ? { [p.id]: d } : {}));

describe("pluginPacks", () => {
  it("shares the library key when the repo matches, whatever the URL form", () => {
    const [pack] = pluginPacks([plugin()], {});
    const [group] = buildSourceGroups([skill("seo", [])]);
    expect(pack.repoKey).toBe(group.key);
    expect(pack.colorKey).toBe(group.key);
  });

  it("falls back to a plugin key when the repo is unknown and skips stale entries", () => {
    const packs = pluginPacks([plugin({ source_repo: null }), plugin({ id: "x@m", installed: false })], {});
    expect(packs).toHaveLength(1);
    expect(packs[0].colorKey).toBe("plugin:claude-seo@agricidaniel-claude-seo");
  });
});

describe("findDuplicatePacks", () => {
  it("flags library skills deployed to Claude Code that the enabled plugin also ships", () => {
    const dups = run([skill("seo", ["claude_code"]), skill("seo-extra", ["claude_code"])], plugin(), detail(["seo", "seo-audit"]));
    expect(dups).toHaveLength(1);
    expect(dups[0].skills.map((s) => s.name)).toEqual(["seo"]);
  });

  it("ignores a disabled plugin and skills not deployed to Claude Code", () => {
    expect(run([skill("seo", ["claude_code"])], plugin({ enabled: false }), detail(["seo"]))).toEqual([]);
    expect(run([skill("seo", ["codex"])], plugin(), detail(["seo"]))).toEqual([]);
  });

  it("ignores a different repo and a plugin whose contents are unknown", () => {
    expect(run([skill("seo", ["claude_code"], "other/repo/seo")], plugin(), detail(["seo"]))).toEqual([]);
    expect(run([skill("seo", ["claude_code"])], plugin(), undefined)).toEqual([]);
  });
});
