import { describe, expect, it } from "vitest";
import type { ManagedSkill, PluginInfo, SkillUsage, ToolInfo, UsageReport } from "./tauri";
import { agentBudgets, attributeUsage, DAY_SECONDS, formatTokens, mostUsed, unusedItems } from "./insights";

const NOW = 1_800_000_000;

const skill = (id: string, name: string, tools: string[], createdDaysAgo = 90) =>
  ({
    id,
    name,
    source_type: "git",
    source_ref: `https://github.com/o/${id}`,
    source_ref_resolved: null,
    central_path: `/lib/${id}`,
    created_at: (NOW - createdDaysAgo * DAY_SECONDS) * 1000,
    targets: tools.map((tool) => ({ tool })),
  }) as unknown as ManagedSkill;

const plugin = (id: string, enabled = true): PluginInfo => ({
  id,
  name: id.split("@")[0],
  marketplace: id.split("@")[1],
  version: "1",
  scope: "user",
  enabled,
  install_path: `/p/${id}`,
  installed: true,
  files_present: true,
  source_repo: null,
  latest_version: null,
  update_available: false,
});

const tool = (key: string): ToolInfo => ({
  key,
  display_name: key,
  installed: true,
  skills_dir: `/${key}`,
  enabled: true,
  is_custom: false,
  has_path_override: false,
  project_relative_skills_dir: null,
  has_project_path_override: false,
  category: "coding",
});

const row = (name: string, uses: number, last30: number, typed = 0): SkillUsage => ({
  name,
  invoked: uses,
  failed: 0,
  typed,
  last_30_days: last30,
  last_used: NOW - DAY_SECONDS,
  projects: ["/work"],
});

const report = (rows: SkillUsage[], sinceDaysAgo = 60): UsageReport => ({
  sessions: 10,
  since: NOW - sinceDaysAgo * DAY_SECONDS,
  skills: rows,
});

const details = {
  "superpowers@obra": { description: null, author: null, skills: ["brainstorming", "tdd"], commands: [], agents: [], hooks: false, mcp_servers: [] },
};

describe("attributeUsage", () => {
  it("credits plugin-prefixed names, bare library names and bundled names, and drops built-ins", () => {
    const skills = [skill("s1", "seo", ["claude_code"])];
    const plugins = [plugin("superpowers@obra")];
    const { bySkill, byPlugin } = attributeUsage(
      report([
        row("superpowers:brainstorming", 7, 7),
        row("tdd", 2, 1),
        row("seo", 1, 0, 3),
        row("model", 0, 0, 6),
      ]),
      skills,
      plugins,
      details,
    );
    expect(byPlugin.get("superpowers@obra")).toMatchObject({ uses: 9, last30Days: 8 });
    expect(bySkill.get("s1")).toMatchObject({ uses: 4 });
    expect(bySkill.size + byPlugin.size).toBe(2);
  });
});

describe("agentBudgets", () => {
  const skills = [skill("a", "a", ["claude_code", "codex"]), skill("b", "b", ["claude_code"])];
  const plugins = [plugin("superpowers@obra"), plugin("off@m", false)];
  const budgets = agentBudgets({
    skills,
    tools: [tool("claude_code"), tool("codex"), tool("cursor")],
    plugins,
    skillCosts: new Map([["a", { always_on: 50, on_invoke: 900 }], ["b", { always_on: 20, on_invoke: 300 }]]),
    pluginCosts: new Map([
      ["superpowers@obra", { cost: { always_on: 848, on_invoke: 50_000 }, exact: true }],
      ["off@m", { cost: { always_on: 999, on_invoke: 1 }, exact: true }],
    ]),
    pluginColorKeys: new Map(),
    usage: attributeUsage(report([row("a", 3, 2)]), skills, plugins, details),
  });

  it("sums what each agent loads, Claude Code with its enabled plugins", () => {
    expect(budgets.map((b) => [b.tool.key, b.total])).toEqual([["claude_code", 918], ["codex", 50]]);
    const claude = budgets[0];
    expect(claude.items.map((i) => i.id)).toEqual(["superpowers@obra", "a", "b"]);
    expect(claude.items[0].exact).toBe(true);
    expect(claude.tracksUsage).toBe(true);
    expect(budgets[1].items[0].usage).toBeNull();
  });

  it("finds unused items and ranks the used ones", () => {
    const unused = unusedItems(budgets[0], report([]), skills, NOW);
    expect(unused.map((i) => i.id)).toEqual(["superpowers@obra", "b"]);
    expect(mostUsed(budgets[0]).map((i) => i.id)).toEqual(["a"]);
  });

  it("does not call anything unused when the transcripts are too short or the skill is new", () => {
    expect(unusedItems(budgets[0], report([], 10), skills, NOW)).toEqual([]);
    const fresh = [skill("a", "a", ["claude_code"]), skill("b", "b", ["claude_code"], 5)];
    const ids = unusedItems(budgets[0], report([]), fresh, NOW).map((i) => i.id);
    expect(ids).not.toContain("b");
  });
});

describe("formatTokens", () => {
  it("rounds for display", () => {
    expect(formatTokens(848)).toBe("848");
    expect(formatTokens(5127)).toBe("5.1k");
    expect(formatTokens(2000)).toBe("2k");
    expect(formatTokens(48_200)).toBe("48k");
  });
});
