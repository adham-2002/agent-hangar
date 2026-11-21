// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, mount } from "../test-utils/mount";
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
}));
const app = vi.hoisted(() => ({ refreshManagedSkills: vi.fn(), skills: [] as unknown[], tools: [] as unknown[] }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o && "tokens" in o ? `${key}:${o.tokens}` : key),
    i18n: { language: "en" },
  }),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../lib/tauri", () => api);
vi.mock("../context/AppContext", () => ({
  useApp: () => ({ managedSkills: app.skills, tools: app.tools, refreshManagedSkills: app.refreshManagedSkills }),
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
});
afterEach(() => cleanup());

async function render() {
  const c = mount(<Insights />);
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

  it("does not call anything unused while the sessions cover too little time", async () => {
    api.getSkillUsage.mockResolvedValue({ sessions: 2, since: NOW_S - 3 * DAY, skills: [] });
    const c = await render();
    expect(c.textContent).toContain("insights.unused.tooEarly");
    expect(c.querySelector('[aria-label="insights.unused.title"] input')).toBeNull();
  });
});
