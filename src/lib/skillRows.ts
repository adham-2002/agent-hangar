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

/** How many of a pack's skills its grid card lists before "+N more". */
export const PACK_PREVIEW = 5;

/** One cell of the grouped card grid. */
export type PackCell =
  | { kind: "single"; row: SkillRow }
  | { kind: "pack"; header: GroupRow; visible: SkillRow[]; hidden: number }
  | { kind: "loose"; row: SkillRow };

/**
 * The rows as grid cells: a source with several skills becomes one pack card
 * listing its skills (the first few while collapsed, all once opened or while
 * searching), and a source with one skill stays a plain skill card, since a
 * frame around a single skill adds nothing. Ungrouped rows stay loose cards.
 */
export function packCells(rows: SkillListRow[], preview = PACK_PREVIEW): PackCell[] {
  const grouped = rows.some((row) => row.kind === "group");
  const cells: PackCell[] = [];
  for (const row of rows) {
    if (row.kind === "skill") {
      // Grouped, a source's skills are listed from its header's group.
      if (!grouped) cells.push({ kind: "loose", row });
      continue;
    }
    const skills = row.group.skills.map((skill): SkillRow => ({ kind: "skill", skill }));
    if (skills.length === 1) {
      cells.push({ kind: "single", row: skills[0] });
      continue;
    }
    const visible = row.expanded ? skills : skills.slice(0, preview);
    cells.push({ kind: "pack", header: row, visible, hidden: skills.length - visible.length });
  }
  return cells;
}
