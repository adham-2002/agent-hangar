import { describe, expect, it } from "vitest";
import { buildActions, previewNames } from "./insightsActions";
import type { BudgetItem, PresetBudget, ProjectOnlyCandidate } from "./insights";
import type { ManagedSkill } from "./tauri";

const item = (id: string, alwaysOn: number): BudgetItem => ({
  kind: "skill",
  id,
  name: id,
  colorKey: "k",
  alwaysOn,
  onInvoke: 0,
  exact: false,
  usage: null,
});

const preset = (id: string, total: number, clashes = 0): PresetBudget =>
  ({
    preset: { id, name: id, sort_order: 0 },
    total,
    heaviestOnInvoke: 0,
    rows: [],
    problems: 0,
    clashes,
    unused: null,
  }) as unknown as PresetBudget;

const skill = (name: string) => ({ id: name, name }) as unknown as ManagedSkill;

describe("buildActions", () => {
  it("is empty when nothing needs doing", () => {
    expect(buildActions({ unused: [], projectOnly: [], presets: [preset("light", 500)], problems: [] })).toEqual([]);
  });

  it("orders by tokens gained, then puts quality before clashes", () => {
    const actions = buildActions({
      unused: [item("a", 300), item("b", 200)],
      projectOnly: [{ item: item("c", 900), projectPath: "/p", projectId: null } as ProjectOnlyCandidate],
      presets: [preset("heavy", 5000, 1), preset("clashy", 800, 2)],
      problems: [
        { skill: skill("x"), worst: 0 },
        { skill: skill("y"), worst: 1 },
      ],
    });
    expect(actions.map((a) => a.id)).toEqual(["heavy:heavy", "projectOnly", "unused", "quality", "clash:clashy"]);
    expect(actions.find((a) => a.kind === "unused")).toMatchObject({ tokens: 500, count: 2 });
    expect(actions.find((a) => a.kind === "quality")).toMatchObject({ count: 2, errors: 1 });
    // A heavy preset carries its clashes instead of a second card.
    expect(actions.find((a) => a.id === "heavy:heavy")?.clashes).toBe(1);
    expect(actions.some((a) => a.id === "clash:heavy")).toBe(false);
  });

  it("previews a few names and counts the rest", () => {
    expect(previewNames(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], more: 2 });
    expect(previewNames(["a"])).toEqual({ shown: ["a"], more: 0 });
  });
});
