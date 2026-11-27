// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, mount } from "../test-utils/mount";
import { SkillRowsLayout } from "./SkillRowsLayout";
import type { SkillListRow } from "../lib/skillRows";
import type { SkillSourceGroup } from "../lib/skillSource";
import type { ManagedSkill } from "../lib/tauri";

const skill = (id: string) => ({ id, name: id }) as ManagedSkill;
const group = (key: string, ids: string[]) =>
  ({ key, label: key, kind: "repo", count: ids.length, skills: ids.map(skill) }) as SkillSourceGroup;

const rows: SkillListRow[] = [
  { kind: "group", group: group("pack-a", ["a1", "a2"]), expanded: true, collapsible: true },
  { kind: "skill", skill: skill("a1") },
  { kind: "skill", skill: skill("a2") },
  { kind: "group", group: group("pack-b", ["b1"]), expanded: false, collapsible: true },
];

const renderRow = (row: SkillListRow) =>
  row.kind === "group" ? (
    <h3 key={`h-${row.group.key}`}>{row.group.key}</h3>
  ) : (
    <article key={row.skill.id}>{row.skill.id}</article>
  );

afterEach(() => cleanup());

describe("SkillRowsLayout", () => {
  it("draws each source as a panel holding its own cards in the grid", () => {
    const c = mount(<SkillRowsLayout rows={rows} grid renderRow={renderRow} />);
    const panels = [...c.querySelectorAll("section")];
    expect(panels.map((p) => p.getAttribute("aria-label"))).toEqual(["pack-a", "pack-b"]);
    expect([...panels[0].querySelectorAll("article")].map((a) => a.textContent)).toEqual(["a1", "a2"]);
    expect(panels[1].querySelectorAll("article")).toHaveLength(0);
  });

  it("keeps the list a single column of rows", () => {
    const c = mount(<SkillRowsLayout rows={rows} grid={false} renderRow={renderRow} />);
    expect(c.querySelectorAll("section")).toHaveLength(0);
    expect(c.querySelectorAll("article")).toHaveLength(2);
  });

  it("uses a plain grid when nothing is grouped", () => {
    const flat: SkillListRow[] = [{ kind: "skill", skill: skill("x") }];
    const c = mount(<SkillRowsLayout rows={flat} grid renderRow={renderRow} />);
    expect(c.querySelectorAll("section")).toHaveLength(0);
    expect(c.querySelector(".grid article")?.textContent).toBe("x");
  });
});
