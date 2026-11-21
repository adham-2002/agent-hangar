import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, Layers, Swords } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import type { ManagedSkill } from "../lib/tauri";
import { formatTokens, type PresetBudget } from "../lib/insights";
import { presetPath } from "../lib/presetRoute";
import { SkillFindings } from "./SkillFindings";

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

interface Props {
  budgets: PresetBudget[];
  /** Background class of a skill's source colour. */
  dot: (skill: ManagedSkill) => string;
  onEdit: (skill: ManagedSkill) => void;
  /** Whether Claude Code usage is known, so the uses column means something. */
  tracksUsage: boolean;
}

/** Each preset's context budget, and how well its skills work together. */
export function PresetBudgets({ budgets, dot, onEdit, tracksUsage }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const maxTotal = Math.max(1, ...budgets.map((b) => b.total));

  if (budgets.length === 0) {
    return <p className="text-[13px] text-muted">{t("insights.presets.empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {budgets.map((budget) => {
        const expanded = open[budget.preset.id] ?? false;
        const withNotes = budget.rows.filter((r) => r.together.length > 0 || r.findings.length > 0);
        return (
          <li key={budget.preset.id} className="rounded-xl border border-border-subtle bg-surface p-3">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [budget.preset.id]: !expanded }))}
              aria-expanded={expanded}
              className="flex w-full items-center gap-2 text-left outline-none"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
              )}
              <Layers className="h-4 w-4 shrink-0 text-muted" />
              <span className="truncate text-[13px] font-medium text-primary">{budget.preset.name}</span>
              <span className="shrink-0 text-[12px] text-muted">
                {t("insights.presets.skills", { count: budget.rows.length })}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-3 text-[12px]">
                {budget.clashes > 0 ? (
                  <span
                    className="flex items-center gap-1 text-amber-600 dark:text-amber-400"
                    title={t("insights.presets.clashes", { count: budget.clashes })}
                  >
                    <Swords className="h-3.5 w-3.5" />
                    {budget.clashes}
                  </span>
                ) : null}
                {budget.problems > 0 ? (
                  <span
                    className="flex items-center gap-1 text-rose-600 dark:text-rose-400"
                    title={t("insights.presets.problems", { count: budget.problems })}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {budget.problems}
                  </span>
                ) : null}
                <span className="tabular-nums text-muted">
                  {t("insights.budget.total", { tokens: formatTokens(budget.total) })}
                </span>
              </span>
            </button>

            <div
              className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-hover"
              style={{ width: `${Math.max(4, (budget.total / maxTotal) * 100)}%` }}
              role="img"
              aria-label={t("insights.budget.total", { tokens: formatTokens(budget.total) })}
            >
              {budget.rows
                .filter((r) => r.alwaysOn > 0)
                .map((row) => (
                  <span
                    key={row.skill.id}
                    title={`${row.skill.name} · ${formatTokens(row.alwaysOn)}`}
                    className={cn("h-full border-r border-surface last:border-r-0", dot(row.skill))}
                    style={{ width: `${(row.alwaysOn / budget.total) * 100}%` }}
                  />
                ))}
            </div>

            {expanded ? (
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-[12px] text-muted">
                  {[
                    t("insights.presets.summary", {
                      tokens: formatTokens(budget.total),
                      heaviest: formatTokens(budget.heaviestOnInvoke),
                    }),
                    budget.unused !== null && budget.unused > 0
                      ? t("insights.presets.unused", { count: budget.unused })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </p>
                {budget.rows.length > 0 ? (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1 font-medium">{t("insights.budget.item")}</th>
                        <th className="py-1 text-right font-medium">{t("insights.budget.alwaysOn")}</th>
                        <th className="py-1 text-right font-medium">{t("insights.budget.onInvoke")}</th>
                        {tracksUsage ? (
                          <th className="py-1 text-right font-medium">{t("insights.budget.uses30")}</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {budget.rows.map((row) => (
                        <tr key={row.skill.id} className="border-t border-border-subtle text-secondary">
                          <td className="py-1.5">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", dot(row.skill))} />
                              <span className="truncate">{row.skill.name}</span>
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{formatTokens(row.alwaysOn)}*</td>
                          <td className="py-1.5 text-right tabular-nums">{formatTokens(row.onInvoke)}*</td>
                          {tracksUsage ? (
                            <td className="py-1.5 text-right tabular-nums">{row.uses30 ?? 0}</td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {withNotes.length > 0 ? (
                  <div className="flex flex-col gap-2" aria-label={t("insights.presets.together")}>
                    <h3 className="text-[12px] font-semibold text-primary">{t("insights.presets.together")}</h3>
                    <ul className="flex flex-col gap-1.5">
                      {withNotes.map((row) => (
                        <li key={row.skill.id} className="rounded-lg border border-border-subtle px-2.5 py-2">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="min-w-0 truncate text-[12px] font-medium text-primary">
                              {row.skill.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => onEdit(row.skill)}
                              className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-[12px] font-medium text-accent-light transition-colors hover:bg-accent-bg"
                            >
                              {t("insights.quality.edit")}
                            </button>
                          </div>
                          <SkillFindings
                            findings={[...row.together, ...row.findings].sort(
                              (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
                            )}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : budget.rows.length > 1 ? (
                  <p className="text-[12px] text-muted">{t("insights.presets.fitTogether")}</p>
                ) : null}

                <Link
                  to={presetPath(budget.preset.id)}
                  className="self-start text-[12px] font-medium text-accent-light hover:underline"
                >
                  {t("insights.presets.open")}
                </Link>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
