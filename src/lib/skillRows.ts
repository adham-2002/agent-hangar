import type { ManagedSkill } from "./tauri";
import type { SkillSourceGroup } from "./skillSource";

/**
 * One row of My Skills: a Source header, or a skill. Both views share the same
 * row list so grouping and the ungrouped list render through one path.
 */
export type SkillListRow =
  | {
      kind: "group";
      group: SkillSourceGroup;
      expanded: boolean;
      /** False while a search forces every Source open: the header then has nothing to toggle. */
      collapsible: boolean;
    }
  | { kind: "skill"; skill: ManagedSkill };

interface BuildSkillRowsOptions {
  /** Null when grouping is off, in which case the filtered skills are the rows. */
  groups: SkillSourceGroup[] | null;
  /** The filtered skills, used only when grouping is off. */
  skills: ManagedSkill[];
  /** Explicit open/closed choice per Source key; absent means "no choice made yet". */
  openBySource: Record<string, boolean>;
  /** A search forces every Source open, so a match can never hide inside one. */
  searching: boolean;
}

export function buildSkillRows({
  groups,
  skills,
  openBySource,
  searching,
}: BuildSkillRowsOptions): SkillListRow[] {
  if (!groups) return skills.map((skill) => ({ kind: "skill", skill }));

  const rows: SkillListRow[] = [];
  for (const group of groups) {
    // Every source gets a header, including one that holds a single skill, so
    // the grouped view reads the same way whatever the group's size. A group of
    // one starts open, because collapsing it by default would hide the only
    // skill it holds without saving a row.
    const expanded = searching || (openBySource[group.key] ?? group.skills.length === 1);
    rows.push({ kind: "group", group, expanded, collapsible: !searching });
    if (expanded) {
      for (const skill of group.skills) rows.push({ kind: "skill", skill });
    }
  }
  return rows;
}

/** Ids of the skills that actually have a row on screen. */
export function renderedSkillIds(rows: SkillListRow[]): string[] {
  return rows.flatMap((row) => (row.kind === "skill" ? [row.skill.id] : []));
}

export type GroupRow = Extract<SkillListRow, { kind: "group" }>;
export type SkillRow = Extract<SkillListRow, { kind: "skill" }>;

/** A source's header with the skills shown under it; `header` is null for
 *  skills listed without grouping. */
export interface SkillRowSection {
  header: GroupRow | null;
  items: SkillRow[];
}

/**
 * The rows regrouped as sections, so the card grid can draw each source as
 * a panel holding its own cards rather than a header lost among them. A
 * collapsed source is a section with no items.
 */
export function sectionRows(rows: SkillListRow[]): SkillRowSection[] {
  const sections: SkillRowSection[] = [];
  for (const row of rows) {
    if (row.kind === "group") {
      sections.push({ header: row, items: [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1].items.push(row);
    } else {
      sections.push({ header: null, items: [row] });
    }
  }
  return sections;
}
