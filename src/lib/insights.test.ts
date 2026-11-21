import { describe, expect, it } from "vitest";
import type { ManagedSkill, PluginInfo, Preset, SkillUsage, ToolInfo, UsageReport } from "./tauri";
import {
  agentBudgets,
  attributeUsage,
  DAY_SECONDS,
  formatTokens,
  mostUsed,
  presetBudgets,
  projectOnlyCandidates,
  unusedItems,
} from "./insights";

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

describe("projectOnlyCandidates", () => {
  const usedIn = (name: string, uses: number, projects: string[]): SkillUsage => ({
    ...row(name, uses, 0),
    projects,
  });
  const skills = [
    skill("seo", "seo", ["claude_code"]),
    skill("pdf", "pdf", ["claude_code"]),
    skill("git", "git", ["claude_code"]),
    skill("rare", "rare", ["claude_code"]),
    skill("home", "home", ["claude_code"]),
  ];
  const build = (rows: SkillUsage[]) =>
    agentBudgets({
      skills,
      tools: [tool("claude_code")],
      plugins: [],
      skillCosts: new Map(skills.map((s, i) => [s.id, { always_on: 100 - i, on_invoke: 0 }])),
      pluginCosts: new Map(),
      pluginColorKeys: new Map(),
      usage: attributeUsage(report(rows), skills, [], {}),
    })[0];
  const rows = [
    // Two sessions in subfolders of one registered project.
    usedIn("seo", 5, ["E:\\Sites\\shop\\web", "e:/sites/shop/"]),
    // An unregistered folder.
    usedIn("pdf", 4, ["/home/me/papers"]),
    // Two projects: stays global.
    usedIn("git", 9, ["/home/me/a", "/home/me/b"]),
    // Too few uses to tell.
    usedIn("rare", 2, ["/home/me/papers"]),
    // The home folder is not a project.
    usedIn("home", 6, ["/home/me"]),
  ];
  const projects = [{ id: "p1", path: "E:\\Sites\\shop" }];

  it("suggests a skill used in one project, mapping subfolders to the registered project", () => {
    const out = projectOnlyCandidates(build(rows), report(rows), projects, "/home/me", NOW);
    expect(out.map((c) => [c.item.id, c.projectPath, c.projectId])).toEqual([
      ["seo", "E:\\Sites\\shop", "p1"],
      ["pdf", "/home/me/papers", null],
    ]);
  });

  it("says nothing while the transcripts cover less than 30 days", () => {
    expect(projectOnlyCandidates(build(rows), report(rows, 10), projects, "/home/me", NOW)).toEqual([]);
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

describe("presetBudgets", () => {
  const preset = (id: string, sort_order: number) => ({ id, name: id, sort_order }) as unknown as Preset;
  const inPresets = (s: ManagedSkill, ...ids: string[]) => ({ ...s, preset_ids: ids }) as ManagedSkill;
  const finding = (code: string, severity: "error" | "warning" | "info" = "warning") => ({
    code,
    severity,
    message: "m",
    params: {},
  });
  const usageReport = (sinceDaysAgo: number): UsageReport => ({
    sessions: 10,
    since: NOW - sinceDaysAgo * DAY_SECONDS,
    skills: [],
  });

  const skills = [
    inPresets(skill("a", "review-a", []), "work"),
    inPresets(skill("b", "review-b", []), "work", "web"),
    inPresets(skill("c", "sql", [], 5), "work"),
    inPresets(skill("d", "seo", []), "web"),
  ];
  const input = (over: Partial<Parameters<typeof presetBudgets>[0]> = {}) => ({
    presets: [preset("web", 2), preset("work", 1)],
    skills,
    skillCosts: new Map([
      ["a", { always_on: 50, on_invoke: 900 }],
      ["b", { always_on: 30, on_invoke: 4000 }],
      ["c", { always_on: 20, on_invoke: 100 }],
      ["d", { always_on: 70, on_invoke: 300 }],
    ]),
    quality: new Map([
      ["a", [finding("description_overlap"), finding("body_long")]],
      ["d", [finding("description_no_when", "info")]],
    ]),
    presetQuality: [
      { preset_id: "work", skills: [{ skill_id: "a", findings: [finding("description_overlap")] }, { skill_id: "b", findings: [finding("description_overlap")] }] },
      { preset_id: "web", skills: [] },
    ],
    usageBySkill: new Map([["b", { uses: 3, last30Days: 3, lastUsed: NOW, projects: [] }]]),
    report: usageReport(60),
    nowSeconds: NOW,
    ...over,
  });

  it("totals each preset's skills, heaviest first, in the user's order", () => {
    const [work, web] = presetBudgets(input());
    expect(work.preset.id).toBe("work");
    expect(work.rows.map((r) => r.skill.id)).toEqual(["a", "b", "c"]);
    expect(work.total).toBe(100);
    expect(work.heaviestOnInvoke).toBe(4000);
    expect(web.total).toBe(100);
  });

  it("reports clashes within the preset, not library-wide ones", () => {
    const [work, web] = presetBudgets(input());
    expect(work.clashes).toBe(2);
    expect(work.rows[0].findings.map((f) => f.code)).toEqual(["body_long"]);
    expect(work.problems).toBe(1);
    expect(web.clashes).toBe(0);
    expect(web.problems).toBe(0);
  });

  it("counts unused skills only when the transcripts cover 30 days, sparing new skills", () => {
    const [work] = presetBudgets(input());
    expect(work.unused).toBe(1);
    expect(presetBudgets(input({ report: usageReport(10) }))[0].unused).toBeNull();
    expect(presetBudgets(input({ usageBySkill: null }))[0].rows[0].uses30).toBeNull();
  });
});