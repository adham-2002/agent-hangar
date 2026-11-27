import type { ReactNode } from "react";
import { sectionRows, type SkillListRow } from "../lib/skillRows";

const GRID = "grid grid-cols-2 gap-3 lg:grid-cols-3";

interface Props {
  rows: SkillListRow[];
  grid: boolean;
  /** One row: a source header or a skill card. Must carry its own key. */
  renderRow: (row: SkillListRow) => ReactNode;
}

/**
 * Library's skills, laid out. The list stays one column of rows. The grid,
 * when skills are grouped by source, draws each source as a panel: its
 * header on top and its own cards inside, so a pack reads as a parent that
 * holds its skills.
 */
export function SkillRowsLayout({ rows, grid, renderRow }: Props) {
  if (!grid) return <div className="flex flex-col gap-0.5 pb-8">{rows.map(renderRow)}</div>;

  const sections = sectionRows(rows);
  if (!sections.some((s) => s.header)) {
    return <div className={`${GRID} pb-8`}>{rows.map(renderRow)}</div>;
  }

  return (
    <div className="flex flex-col gap-3 pb-8">
      {sections.map((section, i) =>
        section.header ? (
          <section
            key={`section-${section.header.group.key}`}
            aria-label={section.header.group.label ?? undefined}
            className="rounded-xl border border-border-subtle bg-surface-hover/30 p-2.5"
          >
            {renderRow(section.header)}
            {section.items.length > 0 ? (
              <div className={`${GRID} mt-2`}>{section.items.map(renderRow)}</div>
            ) : null}
          </section>
        ) : (
          <div key={`loose-${i}`} className={GRID}>
            {section.items.map(renderRow)}
          </div>
        ),
      )}
    </div>
  );
}
