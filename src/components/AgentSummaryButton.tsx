import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import { agentSummaryText, type AgentSummary } from "../lib/agentSummary";
import { Popover } from "./Popover";

interface Props {
  summary: AgentSummary | null;
  /** The per-agent switches, shown when the summary is opened. */
  children: ReactNode;
  className?: string;
}

/**
 * Where a skill or pack is deployed, in a few words: quiet when it is on
 * every agent, amber when it is on none. Opening it shows the switches.
 */
export function AgentSummaryButton({ summary, children, className }: Props) {
  const { t } = useTranslation();
  if (!summary) return null;
  const text = agentSummaryText(summary, t);
  return (
    <Popover
      label={t("mySkills.agents.edit", { summary: text })}
      trigger={text}
      triggerClassName={cn(
        "max-w-[180px] truncate rounded-md px-1 py-0.5 text-[12px] transition-colors hover:bg-surface-hover",
        summary.kind === "all" && "text-faint hover:text-muted",
        summary.kind === "some" && "text-secondary",
        summary.kind === "none" && "font-medium text-amber-600 dark:text-amber-400",
        className,
      )}
    >
      {() => (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted">{t("mySkills.agents.title")}</span>
          {children}
        </div>
      )}
    </Popover>
  );
}
