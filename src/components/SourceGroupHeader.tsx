import { AlertTriangle, ChevronDown, ChevronRight, Square, SquareCheck, SquareMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ManagedSkill, ToolInfo } from "../lib/tauri";
import type { SourceColorClass } from "../lib/sourceColor";
import { CardActionMenu, type CardAction } from "./CardActionMenu";
import { PackAgentDots } from "./PackAgentDots";
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
  /** Span the whole row of the card grid. */
  fullWidth: boolean;
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
  fullWidth,
  alsoPlugin,
  selection,
  onToggleSelect,
  tools,
  onTogglePackAgent,
  pendingAgentKey,
  agentsDisabled,
  actions,
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

  return (
    <div
      className={cn(
        "flex items-center gap-1 border-b border-border-subtle pt-3 pb-1 text-muted",
        fullWidth && "col-span-full"
      )}
    >
      {collapsible ? (
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
      )}
      <PackAgentDots
        skills={skills}
        tools={tools}
        onToggle={onTogglePackAgent}
        pendingKey={pendingAgentKey}
        disabled={agentsDisabled}
      />
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
    </div>
  );
}
