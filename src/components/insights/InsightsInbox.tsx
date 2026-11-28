import { useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, FolderInput, Layers, ShieldCheck, Swords, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../utils";
import { formatTokens } from "../../lib/insights";
import { previewNames, type InsightAction, type InsightActionKind } from "../../lib/insightsActions";

const ICONS: Record<InsightActionKind, typeof Trash2> = {
  unused: Trash2,
  projectOnly: FolderInput,
  heavyPreset: Layers,
  presetClash: Swords,
  quality: ShieldCheck,
};

export interface InboxButton {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

interface Props {
  actions: InsightAction[];
  /** Tokens the busiest agent loads per session, for the all-clear line. */
  summary: { agent: string; tokens: number } | null;
  /** The list an action expands into, if it has one (unused, quality, …). */
  details: (action: InsightAction) => ReactNode;
  buttons: (action: InsightAction) => InboxButton[];
  onSeeMap: () => void;
}

/**
 * Insights as a to-do list: only what is worth doing, biggest gain first. Each
 * card says what is wrong, what fixing it gains, and offers the fix; the full
 * list behind it opens in place. With nothing to do, one line says so.
 */
export function InsightsInbox({ actions, summary, details, buttons, onSeeMap }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const saves = actions
    .filter((a) => a.kind === "unused" || a.kind === "projectOnly")
    .reduce((n, a) => n + a.tokens, 0);

  if (actions.length === 0) {
    return (
      <section aria-label={t("insights.inbox.title")} className="app-panel flex items-start gap-3 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-primary">{t("insights.inbox.allGood")}</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {summary
              ? t("insights.inbox.allGoodBody", { agent: summary.agent, tokens: formatTokens(summary.tokens) })
              : t("insights.inbox.allGoodEmpty")}
          </p>
          <button type="button" onClick={onSeeMap} className="mt-2 text-[12px] font-medium text-accent-light hover:underline">
            {t("insights.inbox.seeMap")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={t("insights.inbox.title")} className="flex flex-col gap-3">
      <p className="text-[13px] text-secondary">
        {saves > 0
          ? t("insights.inbox.summarySaves", { count: actions.length, tokens: formatTokens(saves) })
          : t("insights.inbox.summary", { count: actions.length })}
      </p>
      <ul className="flex flex-col gap-2">
        {actions.map((action) => {
          const Icon = ICONS[action.kind];
          const { shown, more } = previewNames(action.names);
          const body = details(action);
          const expanded = open === action.id && body !== null;
          return (
            <li key={action.id} className="app-panel overflow-hidden">
              <div className="flex flex-wrap items-start gap-3 p-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="text-[13px] font-semibold text-primary">
                      {t(`insights.inbox.kind.${action.kind}`, {
                        count: action.count,
                        preset: action.names[0],
                        errors: action.errors ?? 0,
                      })}
                    </h3>
                    {action.tokens > 0 ? (
                      <span
                        className={cn(
                          "text-[12px] tabular-nums",
                          action.kind === "heavyPreset" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {action.kind === "heavyPreset"
                          ? t("insights.inbox.weighs", { tokens: formatTokens(action.tokens) })
                          : t("insights.inbox.saves", { tokens: formatTokens(action.tokens) })}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-muted">
                    {action.kind === "heavyPreset" || action.kind === "presetClash"
                      ? t(
                          action.kind === "heavyPreset" && !action.clashes
                            ? "insights.inbox.why.heavyPresetNoClash"
                            : `insights.inbox.why.${action.kind}`,
                          { count: action.count, clashes: action.clashes ?? 0 },
                        )
                      : shown.join(", ") + (more > 0 ? ` ${t("insights.inbox.more", { count: more })}` : "")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {body !== null ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : action.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-secondary outline-none hover:bg-surface-hover"
                    >
                      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {t("insights.inbox.review")}
                    </button>
                  ) : null}
                  {buttons(action).map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      onClick={b.onClick}
                      className={
                        b.primary
                          ? "rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white outline-none hover:opacity-90"
                          : "app-button-secondary"
                      }
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
              {expanded ? <div className="border-t border-border-faint px-3 py-3">{body}</div> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
