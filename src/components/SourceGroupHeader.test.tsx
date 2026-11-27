// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, mount } from "../test-utils/mount";
import { SourceGroupHeader } from "./SourceGroupHeader";
import type { ManagedSkill, ToolInfo } from "../lib/tauri";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const skill = (id: string, tools: string[]) =>
  ({ id, name: id, targets: tools.map((tool) => ({ tool })) }) as unknown as ManagedSkill;

const tool = (key: string, display_name: string): ToolInfo => ({
  key,
  display_name,
  installed: true,
  skills_dir: `/agents/${key}`,
  enabled: true,
  is_custom: false,
  has_path_override: false,
  project_relative_skills_dir: null,
  has_project_path_override: false,
  category: "coding",
});

const tools = [tool("claude_code", "Claude Code"), tool("codex", "Codex")];
// claude_code has both skills, codex one of the two.
const skills = [skill("a", ["claude_code", "codex"]), skill("b", ["claude_code"])];

function renderHeader(over: Partial<Parameters<typeof SourceGroupHeader>[0]> = {}) {
  const props = {
    label: "obra/superpowers",
    count: 2,
    skills,
    color: "bg-sky-500" as const,
    collapsible: true,
    expanded: false,
    onToggleOpen: vi.fn(),
    inPanel: false,
    alsoPlugin: false,
    selection: "none" as const,
    onToggleSelect: vi.fn(),
    tools,
    onTogglePackAgent: vi.fn(),
    pendingAgentKey: null,
    agentsDisabled: false,
    actions: [{ key: "delete", label: "Delete 2", icon: null, danger: true, onSelect: vi.fn() }],
    ...over,
  };
  const container = mount(<SourceGroupHeader {...props} />);
  return { container, props };
}

afterEach(() => cleanup());

describe("SourceGroupHeader", () => {
  it("names the source with its colour and count", () => {
    const { container } = renderHeader();
    expect(container.textContent).toContain("obra/superpowers");
    expect(container.textContent).toContain("2");
    expect(container.querySelector(".bg-sky-500")).not.toBeNull();
    expect(container.textContent).not.toContain("mySkills.pluginPacks.alsoPlugin");
  });

  it("flags a pack Claude Code also gets from a plugin", () => {
    const { container } = renderHeader({ alsoPlugin: true });
    expect(container.textContent).toContain("mySkills.pluginPacks.alsoPlugin");
  });

  it("folds when collapsible and is plain text while a search holds it open", () => {
    const { container, props } = renderHeader();
    const toggle = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle.click());
    expect(props.onToggleOpen).toHaveBeenCalledOnce();

    cleanup();
    const plain = renderHeader({ collapsible: false });
    expect(plain.container.querySelector("button[aria-expanded]")).toBeNull();
  });

  it("shows a partial selection and selects the pack on click", () => {
    const { container, props } = renderHeader({ selection: "some" });
    const box = container.querySelector('[role="checkbox"]') as HTMLButtonElement;
    expect(box.getAttribute("aria-checked")).toBe("mixed");
    act(() => box.click());
    expect(props.onToggleSelect).toHaveBeenCalledOnce();
  });

  it("shows each agent's pack state and toggles it", () => {
    const { container, props } = renderHeader();
    const switches = [...container.querySelectorAll("button[aria-pressed]")] as HTMLButtonElement[];
    expect(switches.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "mixed"]);
    act(() => switches[1].click());
    expect(props.onTogglePackAgent).toHaveBeenCalledWith("codex");
  });

  it("holds the agent switches while another update runs", () => {
    const { container } = renderHeader({ agentsDisabled: true });
    const switches = [...container.querySelectorAll("button[aria-pressed]")] as HTMLButtonElement[];
    expect(switches.length).toBe(2);
    expect(switches.every((b) => b.disabled)).toBe(true);
  });

  it("runs a pack action from its menu", () => {
    const { container, props } = renderHeader();
    const menu = container.querySelector('button[aria-label="mySkills.sourceGroup.actions"]') as HTMLButtonElement;
    act(() => menu.click());
    const del = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Delete 2"))!;
    act(() => del.click());
    expect(props.actions[0].onSelect).toHaveBeenCalledOnce();
  });
});
