// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, mount } from "../test-utils/mount";
import { Memory } from "./Memory";
import type { MemoryReport } from "../lib/tauri";

const api = vi.hoisted(() => ({
  getAgentMemory: vi.fn(),
  readAgentMemory: vi.fn(),
  deleteAgentMemory: vi.fn(),
  moveAgentMemoryToGlobal: vi.fn(),
  checkSkillDraft: vi.fn(),
  createSkill: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("../lib/tauri", () => api);
vi.mock("../context/AppContext", () => ({ useApp: () => ({ refreshManagedSkills: vi.fn() }) }));

const report = (): MemoryReport => ({
  global: [],
  global_always_on: 0,
  projects: [
    {
      slug: "E--work-shop",
      project_path: "E:\\work\\shop",
      memory_dir: "",
      index: { lines: 2, tokens: 40, loaded_tokens: 40 },
      instructions: [],
      findings: [],
      always_on: 40,
      memories: [
        {
          file: "ask-first.md",
          path: "",
          name: "ask-first",
          description: "Ask before large refactors",
          kind: "feedback",
          bytes: 200,
          tokens: 60,
          modified: null,
          in_index: true,
          findings: [{ code: "global_candidate", severity: "info", message: "m", params: {} }],
        },
        {
          file: "deploy.md",
          path: "",
          name: "deploy",
          description: "How the shop deploys",
          kind: "project",
          bytes: 200,
          tokens: 60,
          modified: null,
          in_index: false,
          findings: [{ code: "not_in_index", severity: "warning", message: "m", params: {} }],
        },
      ],
    },
  ],
});

const flush = () => act(async () => { await Promise.resolve(); });
const byLabel = (label: string) =>
  [...document.body.querySelectorAll(`button[aria-label="${label}"]`)] as HTMLButtonElement[];
const byText = (label: string) =>
  [...document.body.querySelectorAll("button")].filter((b) => b.textContent?.includes(label)) as HTMLButtonElement[];

async function render() {
  const c = mount(<Memory />);
  for (let i = 0; i < 4; i++) await flush();
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getAgentMemory.mockResolvedValue(report());
  api.readAgentMemory.mockResolvedValue("---\nname: ask-first\n---\nAsk before large refactors.");
  api.deleteAgentMemory.mockResolvedValue("/trash/ask-first.md");
  api.moveAgentMemoryToGlobal.mockResolvedValue("/trash/ask-first.md");
  api.checkSkillDraft.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("Memory", () => {
  it("lists each project's memories with their findings", async () => {
    const c = await render();
    expect(c.textContent).toContain("shop");
    expect(c.textContent).toContain("ask-first");
    expect(c.textContent).toContain("quality.codes.not_in_index");
  });

  it("filters to memories with problems, ignoring tips", async () => {
    const c = await render();
    const box = c.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => box.click());
    expect(c.textContent).toContain("deploy");
    expect(c.textContent).not.toContain("Ask before large refactors");
  });

  it("deletes only after confirmation", async () => {
    await render();
    await act(async () => byLabel("memory.delete")[0].click());
    expect(api.deleteAgentMemory).not.toHaveBeenCalled();
    const confirm = byText("memory.delete");
    await act(async () => confirm[confirm.length - 1].click());
    for (let i = 0; i < 4; i++) await flush();
    expect(api.deleteAgentMemory).toHaveBeenCalledWith("E--work-shop", "ask-first.md");
    expect(toast.success).toHaveBeenCalled();
    expect(api.getAgentMemory).toHaveBeenCalledTimes(2);
  });

  it("moves a memory to the global CLAUDE.md after confirmation", async () => {
    await render();
    await act(async () => byLabel("memory.moveToGlobal")[0].click());
    const confirm = byText("memory.moveToGlobal");
    await act(async () => confirm[confirm.length - 1].click());
    for (let i = 0; i < 4; i++) await flush();
    expect(api.moveAgentMemoryToGlobal).toHaveBeenCalledWith("E--work-shop", "ask-first.md");
  });

  it("opens the skill editor filled from the memory", async () => {
    await render();
    await act(async () => byLabel("memory.makeSkill")[0].click());
    for (let i = 0; i < 4; i++) await flush();
    const inputs = [...document.body.querySelectorAll("input, textarea")] as HTMLInputElement[];
    const values = inputs.map((i) => i.value);
    expect(values).toContain("ask-first");
    expect(values).toContain("Ask before large refactors");
    expect(values.some((v) => v.includes("Ask before large refactors."))).toBe(true);
  });
});
