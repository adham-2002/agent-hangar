// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, mount } from "../test-utils/mount";
import { SkillRowsLayout, type RowPlace } from "./SkillRowsLayout";
import type { SkillListRow } from "../lib/skillRows";
import type { SkillSourceGroup } from "../lib/skillSource";
import type { ManagedSkill } from "../lib/tauri";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o && "count" in o ? `${key}:${o.count}` : key),
  }),
}));

const skill = (id: string) => ({ id, name: id }) as ManagedSkill;
const group = (key: string, ids: string[]) =>
  ({ key, label: key, kind: "repo", count: ids.length, skills: ids.map(skill) }) as SkillSourceGroup;

const big = group("pack-a", ["a1", "a2", "a3", "a4", "a5", "a6"]);
const rows: SkillListRow[] = [
  { kind: "group", group: big, expanded: false, collapsible: true },
  { kind: "group", group: group("solo", ["s1"]), expanded: true, collapsible: true },
  { kind: "skill", skill: skill("s1") },
];

const renderRow = (row: SkillListRow, place: RowPlace) =>
  row.kind === "group" ? (
    <h3 key={`h-${row.group.key}`} data-place={place}>{row.group.key}</h3>
  ) : (
    <span key={row.skill.id} data-place={place}>{row.skill.id}</span>
  );

afterEach(() => cleanup());

describe("SkillRowsLayout", () => {
  it("draws a pack as one card listing its skills, and a lone skill as a plain card", () => {
    const c = mount(<SkillRowsLayout rows={rows} grid renderRow={renderRow} onToggleGroup={() => {}} />);
    const cards = [...c.querySelectorAll("article")];
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector("h3")?.dataset.place).toBe("packHeader");
    expect([...cards[0].querySelectorAll("span[data-place='packItem']")].map((s) => s.textContent)).toEqual([
      "a1", "a2", "a3", "a4", "a5",
    ]);
    expect(c.querySelector("span[data-place='card']")?.textContent).toBe("s1");
    expect(c.textContent).not.toContain("solo");
  });

  it("opens a pack from its +N more button", async () => {
    const onToggle = vi.fn();
    const c = mount(<SkillRowsLayout rows={rows} grid renderRow={renderRow} onToggleGroup={onToggle} />);
    const more = [...c.querySelectorAll("button")].find((b) => b.textContent === "mySkills.packCard.more:1")!;
    await act(async () => more.click());
    expect(onToggle).toHaveBeenCalledWith("pack-a", true);
  });

  it("keeps the list a single column of rows", () => {
    const c = mount(<SkillRowsLayout rows={rows} grid={false} renderRow={renderRow} onToggleGroup={() => {}} />);
    expect(c.querySelectorAll("article")).toHaveLength(0);
    expect([...c.querySelectorAll("[data-place]")].every((e) => (e as HTMLElement).dataset.place === "list")).toBe(true);
  });
});
