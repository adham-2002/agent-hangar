// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, mount } from "../test-utils/mount";
import { MemoryRouter } from "react-router-dom";
import { Insights } from "./Insights";
import type { ManagedSkill, ToolInfo } from "../lib/tauri";

const NOW_S = Math.floor(Date.now() / 1000);
const DAY = 86_400;

const api = vi.hoisted(() => ({
  getSkillUsage: vi.fn(),
  getContextCosts: vi.fn(),
  listPlugins: vi.fn(),
  getPluginDetail: vi.fn(),
  setPluginEnabled: vi.fn(),
  unsyncSkillFromTool: vi.fn(),
  checkLibraryQuality: vi.fn(),
  checkSkillDraft: vi.fn(),
  getSkillDocument: vi.fn(),
  addProject: vi.fn(),
  exportSkillToProject: vi.fn(),
  getAgentMemory: vi.fn(),
  checkPresetQuality: vi.fn(),
}));
const app = vi.hoisted(() => ({
  refreshManagedSkills: vi.fn(),
  refreshProjects: vi.fn(),
  skills: [] as unknown[],
  tools: [] as unknown[],
  projects: [] as unknown[],
  presets: [] as unknown[],
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o && "tokens" in o ? `${key}:${o.tokens}` : key),
    i18n: { language: "en" },
  }),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn().mockResolvedValue("/home/me") }));
vi.mock("../lib/tauri", () => api);
vi.mock("../context/AppContext", () => ({
  useApp: () => ({
    managedSkills: app.skills,
    tools: app.tools,
    refreshManagedSkills: app.refreshManagedSkills,
    projects: app.projects,
    refreshProjects: app.refreshProjects,
    presets: app.presets,
  }),
}));

const skill = (id: string, createdDaysAgo = 90) =>
  ({
    id,
    name: id,
    source_type: "git",
    source_ref: "https://github.com/o/pack",
    source_ref_resolved: null,
    central_path: `/lib/${id}`,
    created_at: (NOW_S - createdDaysAgo * DAY) * 1000,
    targets: [{ tool: "claude_code" }],
    tags: [],
  }) as unknown as ManagedSkill;

const claude: ToolInfo = {
  key: "claude_code",
  display_name: "Claude Code",
  installed: true,
  skills_dir: "/c",
  enabled: true,
  is_custom: false,
  has_path_override: false,
  project_relative_skills_dir: null,
  has_project_path_override: false,
  category: "coding",
};

const flush = () => act(async () => { await Promise.resolve(); });
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  app.skills = [skill("used"), skill("idle")];
  app.tools = [claude];
  api.listPlugins.mockResolvedValue([]);
  api.getContextCosts.mockResolvedValue({
    skills: [
      { id: "used", cost: { always_on: 60, on_invoke: 2000 } },
      { id: "idle", cost: { always_on: 140, on_invoke: 5000 } },
    ],
    plugins: [],
  });
  api.getSkillUsage.mockResolvedValue({
    sessions: 12,
    since: NOW_S - 60 * DAY,
    skills: [{ name: "used", invoked: 5, failed: 0, typed: 0, last_30_days: 4, last_used: NOW_S - DAY, projects: [] }],
  });
  api.unsyncSkillFromTool.mockResolvedValue(undefined);
  api.checkLibraryQuality.mockResolvedValue([]);
  api.exportSkillToProject.mockResolvedValue(undefined);
  app.projects = [];
  api.getAgentMemory.mockResolvedValue({ global: [], global_always_on: 0, projects: [] });
  api.checkPresetQuality.mockResolvedValue([]);
  app.presets = [];
});
afterEach(() => cleanup());

async function render() {
  const c = mount(
    <MemoryRouter>
      <Insights />
    </MemoryRouter>,
  );
  for (let i = 0; i < 4; i++) await flush();
  return c;
}

describe("Insights", () => {
  it("shows each agent's context budget", async () => {
    const c = await render();
    expect(c.textContent).toContain("Claude Code");
    expect(c.textContent).toContain("insights.budget.total:200");
  });

  it("lists the idle skill as unused and the used one as most used", async () => {
    const c = await render();
    const unused = c.querySelector('[aria-label="insights.unused.title"]')!;
    expect(unused.textContent).toContain("idle");
    expect(unused.textContent).not.toContain("used ");
    const top = c.querySelector('[aria-label="insights.usage.title"]')!;
    expect(top.textContent).toContain("used");
  });

  it("cleans up only after confirmation, removing the skill from Claude Code", async () => {
    const c = await render();
    const box = c.querySelector('[aria-label="insights.unused.title"] input[type="checkbox"]') as HTMLInputElement;
    await act(async () => box.click());
    await act(async () => button("insights.unused.cleanUp").click());
    expect(api.unsyncSkillFromTool).not.toHaveBeenCalled();
    await act(async () => button("insights.unused.confirm").click());
    for (let i = 0; i < 4; i++) await flush();
    expect(api.unsyncSkillFromTool).toHaveBeenCalledWith("idle", "claude_code");
    expect(toast.success).toHaveBeenCalled();
  });

  it("moves a skill used in one project into it, project first, after confirmation", async () => {
    app.projects = [{ id: "p1", name: "shop", path: "/work/shop" }];
    api.getSkillUsage.mockResolvedValue({
      sessions: 12,
      since: NOW_S - 60 * DAY,
      skills: [
        { name: "used", invoked: 5, failed: 0, typed: 0, last_30_days: 4, last_used: NOW_S - DAY, projects: ["/work/shop/web"] },
      ],
    });
    const c = await render();
    const section = c.querySelector('[aria-label="insights.projectOnly.title"]')!;
    expect(section.textContent).toContain("used");
    await act(async () => button("insights.projectOnly.move").click());
    expect(api.exportSkillToProject).not.toHaveBeenCalled();
    const confirm = [...document.body.querySelectorAll("button")].filter((b) =>
      b.textContent?.includes("insights.projectOnly.move"),
    );
    await act(async () => confirm[confirm.length - 1].click());
    for (let i = 0; i < 4; i++) await flush();
    expect(api.addProject).not.toHaveBeenCalled();
    expect(api.exportSkillToProject).toHaveBeenCalledWith("used", "p1", ["claude_code"]);
    expect(api.unsyncSkillFromTool).toHaveBeenCalledWith("used", "claude_code");
    expect(api.exportSkillToProject.mock.invocationCallOrder[0]).toBeLessThan(
      api.unsyncSkillFromTool.mock.invocationCallOrder[0],
    );
  });

  it("keeps the skill in Claude Code when it cannot be added to the project", async () => {
    app.projects = [{ id: "p1", name: "shop", path: "/work/shop" }];
    api.getSkillUsage.mockResolvedValue({
      sessions: 12,
      since: NOW_S - 60 * DAY,
      skills: [
        { name: "used", invoked: 5, failed: 0, typed: 0, last_30_days: 4, last_used: NOW_S - DAY, projects: ["/work/shop"] },
      ],
    });
    api.exportSkillToProject.mockRejectedValue(new Error("conflict"));
    await render();
    await act(async () => button("insights.projectOnly.move").click());
    const confirm = [...document.body.querySelectorAll("button")].filter((b) =>
      b.textContent?.includes("insights.projectOnly.move"),
    );
    await act(async () => confirm[confirm.length - 1].click());
    for (let i = 0; i < 4; i++) await flush();
    expect(api.unsyncSkillFromTool).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("lists skills with problems and folds the ones with only tips", async () => {
    api.checkLibraryQuality.mockResolvedValue([
      { skill_id: "idle", findings: [{ code: "description_missing", severity: "error", message: "m", params: {} }] },
      { skill_id: "used", findings: [{ code: "description_no_when", severity: "info", message: "m", params: {} }] },
    ]);
    const c = await render();
    const section = c.querySelector('[aria-label="insights.quality.title"]')!;
    expect(section.textContent).toContain("idle");
    expect(section.textContent).toContain("quality.codes.description_missing");
    expect(section.textContent).not.toContain("quality.codes.description_no_when");
    await act(async () => button("insights.quality.tips").click());
    expect(section.textContent).toContain("quality.codes.description_no_when");
  });

  it("shows each preset's budget and the clashes between its skills", async () => {
    app.presets = [{ id: "p1", name: "Frontend", sort_order: 0 }];
    app.skills = [
      { ...(skill("used") as object), preset_ids: ["p1"] },
      { ...(skill("idle") as object), preset_ids: ["p1"] },
    ];
    api.checkPresetQuality.mockResolvedValue([
      {
        preset_id: "p1",
        skills: [
          {
            skill_id: "idle",
            findings: [{ code: "description_overlap", severity: "warning", message: "m", params: {} }],
          },
        ],
      },
    ]);
    const c = await render();
    const section = c.querySelector('[aria-label="insights.presets.title"]')!;
    expect(section.textContent).toContain("Frontend");
    expect(section.textContent).toContain("insights.budget.total:200");
    await act(async () => (section.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
    expect(section.textContent).toContain("quality.codes.description_overlap");
  });

  it("does not call anything unused while the sessions cover too little time", async () => {
    api.getSkillUsage.mockResolvedValue({ sessions: 2, since: NOW_S - 3 * DAY, skills: [] });
    const c = await render();
    expect(c.textContent).toContain("insights.unused.tooEarly");
    expect(c.querySelector('[aria-label="insights.unused.title"] input')).toBeNull();
  });
});
