import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ManagedSkill, ToolInfo } from "../lib/tauri";
import { packAgentState, type PackAgentState } from "../lib/packTargets";
import { hasAgentIcon } from "../lib/agentIcons";
import { AgentIcon } from "./AgentIcon";
import { cn } from "../utils";

interface Props {
  skills: ManagedSkill[];
  tools: ToolInfo[];
  /** Pack-level click on one agent: the parent works out add or remove. */
  onToggle: (toolKey: string) => void;
  /** Agent currently being updated for this pack. */
  pendingKey?: string | null;
  /** Another pack operation is running; every dot waits for it. */
  disabled?: boolean;
}

function shortLabel(displayName: string, key: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || key).slice(0, 2).toUpperCase();
}

const stateClass: Record<PackAgentState, string> = {
  all: "bg-surface",
  // Partly deployed: dimmed, with an accent ring so it reads as "in between".
  some: "bg-surface opacity-80 ring-1 ring-inset ring-accent/70",
  none: "bg-surface opacity-40",
};

/**
 * One switch per agent for a whole pack, in the same visual language as a
 * card's agent dots (`SyncDots`), plus a partial state.
 */
export function PackAgentDots({ skills, tools, onToggle, pendingKey, disabled }: Props) {
  const { t } = useTranslation();
  const activeTools = tools.filter((tool) => tool.installed && tool.enabled);
  if (skills.length === 0 || activeTools.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-[2px]">
      {activeTools.map((tool) => {
        const state = packAgentState(skills, tool.key);
        const pending = pendingKey === tool.key;
        const deployed = skills.filter((s) => s.targets.some((x) => x.tool === tool.key)).length;
        const title = t(
          state === "all" ? "mySkills.sourceGroup.agentRemove" : "mySkills.sourceGroup.agentAdd",
          { agent: tool.display_name, deployed, total: skills.length },
        );
        const useIcon = hasAgentIcon(tool.key);
        return (
          <button
            key={tool.key}
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={state === "all" ? true : state === "some" ? "mixed" : false}
            disabled={disabled || pending}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(tool.key);
            }}
            className={cn(
              "inline-flex h-[18px] w-[18px] shrink-0 select-none items-center justify-center overflow-hidden rounded-[4px] transition-colors",
              useIcon
                ? stateClass[state]
                : cn(
                    "border font-mono text-[9px] font-semibold tracking-tight",
                    state === "none"
                      ? "border-border-subtle bg-surface-hover text-faint"
                      : "border-transparent bg-surface-active text-primary",
                    state === "some" && "ring-1 ring-inset ring-accent/70",
                  ),
              !disabled && !pending && "cursor-pointer hover:ring-1 hover:ring-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              disabled && !pending && "cursor-wait",
            )}
          >
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted" />
            ) : useIcon ? (
              <AgentIcon agentKey={tool.key} className="h-full w-full rounded-[4px] border-0 bg-transparent" />
            ) : (
              shortLabel(tool.display_name, tool.key)
            )}
          </button>
        );
      })}
    </div>
  );
}
