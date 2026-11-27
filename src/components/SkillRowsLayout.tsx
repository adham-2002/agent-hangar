import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PACK_PREVIEW, packCells, type SkillListRow } from "../lib/skillRows";

/**
 * Where a row is drawn: a row of the list, a card of the grid, the header of
 * a pack card, or one skill listed inside a pack card.
 */
export type RowPlace = "list" | "card" | "packHeader" | "packItem";

interface Props {
  rows: SkillListRow[];
  grid: boolean;
  /** One row in its place. Must carry its own key. */
  renderRow: (row: SkillListRow, place: RowPlace) => ReactNode;
  /** Open or fold a pack card. */
  onToggleGroup: (groupKey: string, open: boolean) => void;
}

/**
 * Library's skills, laid out. The list stays one column of rows. The grid
 * shows each pack as one card that lists its skills, so a pack reads as one
 * thing; a source with a single skill is a plain skill card.
 */
export function SkillRowsLayout({ rows, grid, renderRow, onToggleGroup }: Props) {
  const { t } = useTranslation();
  if (!grid) {
    return <div className="flex flex-col gap-0.5 pb-8">{rows.map((row) => renderRow(row, "list"))}</div>;
  }

  return (
    <div className="grid grid-cols-2 items-start gap-3 pb-8 lg:grid-cols-3">
      {packCells(rows).map((cell) => {
        if (cell.kind !== "pack") return renderRow(cell.row, "card");
        const { header, visible, hidden } = cell;
        return (
          <article
            key={`pack-${header.group.key}`}
            aria-label={header.group.label ?? undefined}
            className="app-panel flex flex-col gap-1 px-2.5 pt-2 pb-2 shadow-card"
          >
            {renderRow(header, "packHeader")}
            <ul className="flex flex-col border-t border-border-faint pt-1">
              {visible.map((row) => (
                <li key={row.skill.id}>{renderRow(row, "packItem")}</li>
              ))}
            </ul>
            {hidden > 0 || (header.expanded && header.collapsible && visible.length > PACK_PREVIEW) ? (
              <button
                type="button"
                onClick={() => onToggleGroup(header.group.key, hidden > 0)}
                className="self-start rounded-md px-1.5 py-0.5 text-[12px] font-medium text-accent-light transition-colors hover:bg-accent-bg"
              >
                {hidden > 0 ? t("mySkills.packCard.more", { count: hidden }) : t("mySkills.packCard.less")}
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
