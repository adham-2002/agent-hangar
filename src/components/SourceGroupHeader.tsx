import { AlertTriangle, ChevronDown, ChevronRight, Square, SquareCheck, SquareMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ManagedSkill, ToolInfo } from "../lib/tauri";
import type { SourceColorClass } from "../lib/sourceColor";
import { CardActionMenu, type CardAction } from "./CardActionMenu";
import { PackAgentDots } from "./PackAgentDots";
import { AgentSummaryButton } from "./AgentSummaryButton";
import { ToggleSwitch } from "./ToggleSwitch";
import { summarizeAgents } from "../lib/agentSummary";
import { cn } from "../utils";

interface Props {
  label: string;
  count: number;
  skills: ManagedSkill[];
  color: SourceColorClass | null;
  /** False while a search forces every source open: the title is plain text then. */
  collapsible: boolean;
  expanded: boolean;
  onToggleOpen: () => void;
  /** The header sits at the top of its pack's panel in the card grid,
   *  which draws the frame, so the header drops its own divider. */
  inPanel: boolean;
  /** Claude Code also gets this pack from an enabled plugin. */
  alsoPlugin: boolean;
  selection: "none" | "some" | "all";
  onToggleSelect: () => void;
  tools: ToolInfo[];
  onTogglePackAgent: (toolKey: string) => void;
  /** The agent currently being updated for this pack. */
  pendingAgentKey: string | null;
  /** Another pack or card update is running; agent switches wait for it. */
  agentsDisabled: boolean;
  actions: CardAction[];
  /** In a card: how many of the pack's skills have an update or a problem. */
  health?: { updates: number; issues: number; unused?: number };
  /** In a card inside a preset: how much of the pack the preset enables, and a switch for all of it. */
  presetProgress?: { enabled: number; total: number; busy: boolean; onToggle: () => void } | null;
}

/**
 * One source's header in Library: its colour and name, a switch per agent for
 * the whole pack, a checkbox that selects it, and a menu of pack-wide actions.
 * Presentational: what each control does is the caller's.
 */
export function SourceGroupHeader({
  label,
  count,
  skills,
  color,
  collapsible,
  expanded,
  onToggleOpen,
  inPanel,
  alsoPlugin,
  selection,
  onToggleSelect,
  tools,
  onTogglePackAgent,
  pendingAgentKey,
  agentsDisabled,
  actions,
  health,
  presetProgress,
}: Props) {
  const { t } = useTranslation();
  const title = (
    <>
      {collapsible ? (
        expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )
      ) : null}
      <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", color ?? "bg-surface-active")} />
      <span className="truncate text-[13px] text-secondary">{label}</span>
      <span className="shrink-0 text-[11px] font-medium text-faint">{count}</span>
      {alsoPlugin ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" />
          {t("mySkills.pluginPacks.alsoPlugin")}
        </span>
      ) : null}
    </>
  );
  const titleClass = "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left font-semibold";
  const selectLabel = t("mySkills.sourceGroup.select", { source: label });

  const titleEl = collapsible ? (
    <button
      type="button"
      onClick={onToggleOpen}
      aria-expanded={expanded}
      className={cn(titleClass, "transition-colors hover:bg-surface-hover hover:text-secondary")}
    >
      {title}
    </button>
  ) : (
    <div className={titleClass}>{title}</div>
  );
  const dots = (
    <PackAgentDots
      skills={skills}
      tools={tools}
      onToggle={onTogglePackAgent}
      pendingKey={pendingAgentKey}
      disabled={agentsDisabled}
    />
  );
  const controls = (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={selection === "all" ? true : selection === "some" ? "mixed" : false}
        title={selectLabel}
        aria-label={selectLabel}
        onClick={onToggleSelect}
        className="shrink-0 rounded-md p-1 transition-colors hover:bg-surface-hover"
      >
        {selection === "all" ? (
          <SquareCheck className="h-3.5 w-3.5 text-accent" />
        ) : selection === "some" ? (
          <SquareMinus className="h-3.5 w-3.5 text-accent" />
        ) : (
          <Square className="h-3.5 w-3.5 text-faint" />
        )}
      </button>
      <CardActionMenu label={t("mySkills.sourceGroup.actions", { source: label })} actions={actions} />
    </>
  );

  // In a card: the name and the pack's menu on top, then one quiet line that
  // says where the pack is deployed and only mentions what needs attention.
  if (inPanel) {
    const summary = summarizeAgents(skills, tools);
    return (
      <div className="flex flex-col text-muted">
        <div className="flex min-w-0 items-center gap-1" title={label}>
          {titleEl}
          {controls}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 pl-5 text-[12px]">
          <AgentSummaryButton summary={summary}>{dots}</AgentSummaryButton>
          {health && health.updates > 0 ? (
            <span className="shrink-0 text-amber-600 dark:text-amber-400">
              · {t("mySkills.packCard.updates", { count: health.updates })}
            </span>
          ) : null}
          {health && health.issues > 0 ? (
            <span className="shrink-0 text-rose-600 dark:text-rose-400">
              · {t("mySkills.packCard.issues", { count: health.issues })}
            </span>
          ) : null}
          {health && health.unused ? (
            <span className="shrink-0 text-muted" title={t("mySkills.packCard.unusedHint")}>
              · {t("mySkills.packCard.unused", { count: health.unused })}
            </span>
          ) : null}
          {presetProgress ? (
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <span className="tabular-nums text-faint">
                {t("mySkills.packCard.enabledOf", { enabled: presetProgress.enabled, total: presetProgress.total })}
              </span>
              <ToggleSwitch
                checked={presetProgress.enabled === presetProgress.total}
                onChange={presetProgress.onToggle}
                loading={presetProgress.busy}
                disabled={presetProgress.busy}
                title={
                  presetProgress.enabled === presetProgress.total
                    ? t("mySkills.packCard.disableAll")
                    : t("mySkills.packCard.enableAll")
                }
              />
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 border-b border-border-subtle pt-3 pb-1 text-muted">
      {titleEl}
      {dots}
      {controls}
    </div>
  );
}
