import type { ManagedSkill, ToolInfo } from "./tauri";
import { packAgentState } from "./packTargets";

/**
 * Where a skill or pack is deployed, said once instead of one icon per agent.
 * The usual case (every agent) is quiet; only a difference is spelled out.
 */
export type AgentSummary =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "some"; names: string[]; partial: boolean; count: number; total: number };

export function summarizeAgents(skills: ManagedSkill[], tools: ToolInfo[]): AgentSummary | null {
  const active = tools.filter((tool) => tool.installed && tool.enabled);
  if (skills.length === 0 || active.length === 0) return null;
  const states = active.map((tool) => ({ tool, state: packAgentState(skills, tool.key) }));
  if (states.every((s) => s.state === "all")) return { kind: "all" };
  const reached = states.filter((s) => s.state !== "none");
  if (reached.length === 0) return { kind: "none" };
  return {
    kind: "some",
    names: reached.map((s) => s.tool.display_name),
    partial: reached.some((s) => s.state === "some"),
    count: reached.length,
    total: active.length,
  };
}

/** Names spelled out up to this many agents; past it, a count. */
export const NAMED_AGENTS_MAX = 2;

/** The summary in words, for a label or a tooltip. */
export function agentSummaryText(
  summary: AgentSummary,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (summary.kind === "all") return t("mySkills.agents.all");
  if (summary.kind === "none") return t("mySkills.agents.none");
  const base =
    summary.names.length <= NAMED_AGENTS_MAX
      ? summary.names.join(" + ")
      : t("mySkills.agents.count", { count: summary.count, total: summary.total });
  return summary.partial ? t("mySkills.agents.partly", { agents: base }) : base;
}
