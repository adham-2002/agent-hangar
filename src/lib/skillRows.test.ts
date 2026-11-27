import { describe, expect, it } from "vitest";
import { buildSkillRows, INDIVIDUAL_KEY, packCells, renderedSkillIds } from "./skillRows";
import { countHiddenSelected } from "./selectionVisibility";
import type { SkillSourceGroup } from "./skillSource";
import type { ManagedSkill } from "./tauri";

const skill = (id: string): ManagedSkill => ({
  id,
  name: id,
  description: null,
  source_type: "git",
  source_ref: null,
  source_ref_resolved: null,
  source_subpath: null,
  source_branch: null,
  source_revision: null,
  remote_revision: null,
  update_status: "local_only",
  last_checked_at: null,
  last_check_error: null,
  central_path: `/fixture/${id}`,
  enabled: true,
  created_at: 0,
  updated_at: 0,
  status: "ok",
  targets: [],
  preset_ids: [],
  tags: [],
});

const group = (key: string, ids: string[]): SkillSourceGroup => ({
  key,
  label: key,
  kind: "repo",
  count: ids.length,
  skills: ids.map(skill),
});

const repoA = group("repo:a", ["a1", "a2"]);
const repoB = group("repo:b", ["b1", "b2"]);
const single = group("repo:c", ["c1"]);

const build = (groups: SkillSourceGroup[] | null, openBySource = {}, searching = false) =>
  buildSkillRows({ groups, skills: [], openBySource, searching });

describe("buildSkillRows", () => {
  it("renders the filtered skills as-is when grouping is off", () => {
    const rows = buildSkillRows({
      groups: null,
      skills: [skill("a1"), skill("b1")],
      openBySource: {},
      searching: false,
    });
    expect(rows.map((row) => row.kind)).toEqual(["skill", "skill"]);
    expect(renderedSkillIds(rows)).toEqual(["a1", "b1"]);
  });

  it("collapses a source of several skills by default", () => {
    const rows = build([repoA, repoB]);
    expect(rows.filter((row) => row.kind === "group")).toHaveLength(2);
    expect(renderedSkillIds(rows)).toEqual([]);
  });

  it("keeps a source of one skill open, so its only skill is not hidden", () => {
    const rows = build([single]);
    expect(renderedSkillIds(rows)).toEqual(["c1"]);
  });

  it("honours an explicit choice over the default", () => {
    expect(renderedSkillIds(build([repoA], { "repo:a": true }))).toEqual(["a1", "a2"]);
    expect(renderedSkillIds(build([single], { "repo:c": false }))).toEqual([]);
  });

  it("opens every source during a search and says so on the header", () => {
    const rows = build([repoA, repoB], {}, true);
    expect(renderedSkillIds(rows)).toEqual(["a1", "a2", "b1", "b2"]);
    const headers = rows.filter((row) => row.kind === "group");
    expect(headers.every((row) => row.kind === "group" && row.expanded && !row.collapsible)).toBe(true);
  });

  it("keeps the header collapsible when nothing is being searched", () => {
    const headers = build([repoA, repoB]).filter((row) => row.kind === "group");
    expect(headers.every((row) => row.kind === "group" && row.collapsible)).toBe(true);
  });
});

describe("hidden selection, as the toolbar and the delete dialog report it", () => {
  const allIds = new Set(["a1", "a2", "b1", "b2"]);

  it("discloses the skills of a source collapsed after they were picked", () => {
    // Both sources collapsed by the user's own clicks, everything selected.
    const rows = build([repoA, repoB], { "repo:a": false, "repo:b": false });
    expect(renderedSkillIds(rows)).toEqual([]);
    expect(countHiddenSelected(allIds, renderedSkillIds(rows))).toBe(4);
  });

  it("discloses only the collapsed source when the other is open", () => {
    const rows = build([repoA, repoB], { "repo:a": true, "repo:b": false });
    expect(countHiddenSelected(allIds, renderedSkillIds(rows))).toBe(2);
  });

  it("discloses the same number whichever way the selection was made", () => {
    // Select-all swept both sources; picking row by row ends in the same state.
    const rows = build([repoA, repoB], { "repo:a": true, "repo:b": false });
    const sweptUp = countHiddenSelected(allIds, renderedSkillIds(rows));
    const picked = countHiddenSelected(new Set(["b1", "b2"]), renderedSkillIds(rows));
    expect(sweptUp).toBe(2);
    expect(picked).toBe(2);
  });

  it("discloses nothing when grouping is off or a search opens everything", () => {
    const ungrouped = buildSkillRows({
      groups: null,
      skills: [skill("a1"), skill("a2"), skill("b1"), skill("b2")],
      openBySource: {},
      searching: false,
    });
    expect(countHiddenSelected(allIds, renderedSkillIds(ungrouped))).toBe(0);
    expect(countHiddenSelected(allIds, renderedSkillIds(build([repoA, repoB], {}, true)))).toBe(0);
  });
});

describe("packCells", () => {
  const big = group("repo:big", ["k1", "k2", "k3", "k4", "k5", "k6", "k7"]);
  const ids = (rows: { skill: ManagedSkill }[]) => rows.map((r) => r.skill.id);

  it("makes one card per pack, previewing its first skills while collapsed", () => {
    const cells = packCells(build([big, repoA]));
    expect(cells.map((c) => c.kind)).toEqual(["pack", "pack"]);
    const first = cells[0];
    if (first.kind !== "pack") throw new Error("pack expected");
    expect(ids(first.visible)).toEqual(["k1", "k2", "k3", "k4", "k5"]);
    expect(first.hidden).toBe(2);
  });

  it("lists every skill of an opened pack, or of every pack while searching", () => {
    const open = packCells(build([big], { "repo:big": true }))[0];
    const searched = packCells(build([big], {}, true))[0];
    for (const cell of [open, searched]) {
      if (cell.kind !== "pack") throw new Error("pack expected");
      expect(cell.visible).toHaveLength(7);
      expect(cell.hidden).toBe(0);
    }
  });

  it("keeps a source of one skill a plain skill card", () => {
    const cells = packCells(build([single, repoB]));
    expect(cells[0].kind).toBe("pack");
    expect(cells[1]).toEqual({ kind: "single", row: { kind: "skill", skill: single.skills[0] } });
  });

  it("leaves ungrouped skills as loose cards", () => {
    const rows = buildSkillRows({ groups: null, skills: [skill("x"), skill("y")], openBySource: {}, searching: false });
    expect(packCells(rows).map((c) => c.kind)).toEqual(["loose", "loose"]);
  });
});

describe("packCells gathering and order", () => {
  const solo = (key: string) => group(key, [`${key}-skill`]);
  const ids = (rows: { skill: ManagedSkill }[]) => rows.map((r) => r.skill.id);
  const individual = { label: "Individual skills", open: false, searching: false };

  it("gathers two or more one-skill sources into one card, after the packs", () => {
    const cells = packCells(build([solo("s1"), repoA, solo("s2")]), { individual });
    expect(cells.map((c) => c.kind)).toEqual(["pack", "pack"]);
    const last = cells[1];
    if (last.kind !== "pack") throw new Error("pack expected");
    expect(last.header.group.key).toBe(INDIVIDUAL_KEY);
    expect(last.header.group.label).toBe("Individual skills");
    expect(ids(last.visible)).toEqual(["s1-skill", "s2-skill"]);
  });

  it("keeps a lone one-skill source a plain card", () => {
    const cells = packCells(build([solo("s1"), repoA]), { individual });
    expect(cells.map((c) => c.kind)).toEqual(["pack", "single"]);
  });

  it("puts skills that need attention first inside a card", () => {
    const cells = packCells(build([group("repo:z", ["z1", "z2", "z3"])]), {
      priority: (s) => (s.id === "z3" ? 0 : 2),
    });
    const pack = cells[0];
    if (pack.kind !== "pack") throw new Error("pack expected");
    expect(ids(pack.visible)).toEqual(["z3", "z1", "z2"]);
  });
});
