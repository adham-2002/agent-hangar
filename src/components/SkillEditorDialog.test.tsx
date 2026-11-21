// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, mount } from "../test-utils/mount";
import type { ManagedSkill } from "../lib/tauri";
import { SkillEditorDialog } from "./SkillEditorDialog";
import { draftSkillMd, hasUpdateSource, isSpecName, toSkillName } from "../lib/skillDraft";

const api = vi.hoisted(() => ({
  checkSkillDraft: vi.fn(),
  createSkill: vi.fn(),
  saveSkillDocument: vi.fn(),
  getSkillDocument: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("../lib/tauri", () => api);
vi.mock("./SkillMarkdown", () => ({ SkillMarkdown: ({ content }: { content: string }) => <pre>{content}</pre> }));

const local = { id: "s1", name: "mine", source_type: "local", source_ref: null } as unknown as ManagedSkill;
const fromGit = { ...local, source_type: "git", source_ref: "https://github.com/o/r" } as ManagedSkill;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  api.checkSkillDraft.mockResolvedValue([]);
  api.createSkill.mockResolvedValue({ skill_id: "new", name: "sql-format" });
  api.saveSkillDocument.mockResolvedValue(undefined);
  api.getSkillDocument.mockResolvedValue({ skill_id: "s1", filename: "SKILL.md", content: "---\nname: mine\n---\nOld\n", central_path: "/lib/mine" });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Let the debounced check run and its promise settle. */
const settle = () =>
  act(async () => {
    vi.advanceTimersByTime(400);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;

describe("helpers", () => {
  it("hold names to the Agent Skills format", () => {
    expect(isSpecName("sql-format")).toBe(true);
    expect(isSpecName("SQL")).toBe(false);
    expect(isSpecName("a--b")).toBe(false);
    expect(toSkillName("My Skill_v2")).toBe("my-skill-v2");
  });

  it("quote the frontmatter so YAML characters stay in the value", () => {
    expect(draftSkillMd("a", 'Use: "x"', "Body")).toBe('---\nname: "a"\ndescription: "Use: \\"x\\""\n---\n\nBody');
  });

  it("warn about edits only where an update would replace them", () => {
    expect(hasUpdateSource(local)).toBe(false);
    expect(hasUpdateSource(fromGit)).toBe(true);
  });
});

describe("SkillEditorDialog", () => {
  it("creates a skill once the name is valid and the check finds no errors", async () => {
    const onSaved = vi.fn();
    const c = mount(<SkillEditorDialog mode={{ kind: "create" }} onClose={vi.fn()} onSaved={onSaved} />);
    await settle();
    const create = () => button("authoring.create");
    expect(create().disabled).toBe(true);

    const [name] = [...c.querySelectorAll("input")];
    const [description, body] = [...c.querySelectorAll("textarea")];
    await type(name, "SQL Format");
    expect(name.value).toBe("sql-format");
    await type(description, "Formats SQL. Use when asked to tidy SQL queries for review.");
    await type(body, "# SQL\n\nRun it.");

    api.checkSkillDraft.mockResolvedValueOnce([{ code: "description_missing", severity: "error", message: "m", params: {} }]);
    await settle();
    expect(create().disabled).toBe(true);

    await type(body, "# SQL\n\nRun it now.");
    await settle();
    expect(create().disabled).toBe(false);
    await act(async () => create().click());
    expect(api.createSkill).toHaveBeenCalledWith(
      "sql-format",
      "Formats SQL. Use when asked to tidy SQL queries for review.",
      "# SQL\n\nRun it now.",
    );
    expect(onSaved).toHaveBeenCalledWith("new");
  });

  it("edits the SKILL.md, warns about a source that updates, and asks before discarding", async () => {
    const onClose = vi.fn();
    const c = mount(<SkillEditorDialog mode={{ kind: "edit", skill: fromGit }} onClose={onClose} onSaved={vi.fn()} />);
    await settle();
    expect(c.textContent).toContain("authoring.sourceWarning");
    const area = c.querySelector("textarea")!;
    expect(area.value).toContain("Old");
    expect(button("authoring.save").disabled).toBe(true);

    await type(area, "---\nname: mine\n---\nNew\n");
    await settle();
    await act(async () => button("common.cancel").click());
    expect(onClose).not.toHaveBeenCalled();
    expect(c.textContent).toContain("authoring.discardPrompt");
    await act(async () => button("authoring.keepEditing").click());

    await act(async () => button("authoring.save").click());
    expect(api.saveSkillDocument).toHaveBeenCalledWith("s1", "---\nname: mine\n---\nNew\n");
    expect(onClose).toHaveBeenCalled();
  });
});
