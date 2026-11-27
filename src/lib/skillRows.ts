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

/** Group key of the card that gathers sources holding a single skill. */
export const INDIVIDUAL_KEY = "__individual__";

export interface PackCellOptions {
  preview?: number;
  /**
   * Gather the sources that hold one skill into one card with this label,
   * when there are at least two of them. Without it each stays its own card.
   */
  individual?: { label: string; open: boolean; searching: boolean };
  /** Lower comes first inside a card: skills that need attention lead. */
  priority?: (skill: ManagedSkill) => number;
}

/**
 * The rows as grid cells: a source with several skills becomes one pack card
 * listing its skills (the first few while collapsed, all once opened or while
 * searching). Sources with a single skill are gathered into one "individual
 * skills" card, so the grid holds one kind of card; a lone one stays a plain
 * skill card. Ungrouped rows stay loose cards.
 */
export function packCells(rows: SkillListRow[], options: PackCellOptions = {}): PackCell[] {
  const preview = options.preview ?? PACK_PREVIEW;
  const order = (skills: ManagedSkill[]) =>
    options.priority
      ? skills
          .map((skill, index) => ({ skill, index, rank: options.priority!(skill) }))
          .sort((a, b) => a.rank - b.rank || a.index - b.index)
          .map((x) => x.skill)
      : skills;
  const toRows = (skills: ManagedSkill[]) => order(skills).map((skill): SkillRow => ({ kind: "skill", skill }));
  const packOf = (header: GroupRow): PackCell => {
    const skills = toRows(header.group.skills);
    const visible = header.expanded ? skills : skills.slice(0, preview);
    return { kind: "pack", header, visible, hidden: skills.length - visible.length };
  };

  const grouped = rows.some((row) => row.kind === "group");
  const cells: PackCell[] = [];
  const singles: GroupRow[] = [];
  for (const row of rows) {
    if (row.kind === "skill") {
      // Grouped, a source's skills are listed from its header's group.
      if (!grouped) cells.push({ kind: "loose", row });
      continue;
    }
    if (row.group.skills.length === 1) singles.push(row);
    else cells.push(packOf(row));
  }

  if (options.individual && singles.length >= 2) {
    const skills = singles.map((row) => row.group.skills[0]);
    const { label, open, searching } = options.individual;
    cells.push(
      packOf({
        kind: "group",
        group: { key: INDIVIDUAL_KEY, label, kind: "individual", count: skills.length, skills } as unknown as GroupRow["group"],
        expanded: searching || open,
        collapsible: !searching,
      }),
    );
  } else {
    for (const row of singles) cells.push({ kind: "single", row: { kind: "skill", skill: row.group.skills[0] } });
  }
  return cells;
}
