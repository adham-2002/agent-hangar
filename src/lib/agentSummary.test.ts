import { describe, expect, it } from "vitest";
import { agentSummaryText, summarizeAgents } from "./agentSummary";
import type { ManagedSkill, ToolInfo } from "./tauri";

const tool = (key: string, name: string, on = true) =>
  ({ key, display_name: name, installed: on, enabled: on }) as ToolInfo;
const skill = (id: string, ...tools: string[]) =>
  ({ id, targets: tools.map((t) => ({ tool: t })) }) as unknown as ManagedSkill;
const tools = [tool("claude", "Claude Code"), tool("cursor", "Cursor"), tool("codex", "Codex"), tool("off", "Off", false)];
const t = (key: string, o?: Record<string, unknown>) => (o ? `${key}:${JSON.stringify(o)}` : key);

describe("summarizeAgents", () => {
  it("stays quiet when every active agent has every skill", () => {
    expect(summarizeAgents([skill("a", "claude", "cursor", "codex")], tools)).toEqual({ kind: "all" });
  });

  it("flags a pack deployed nowhere", () => {
    expect(summarizeAgents([skill("a"), skill("b", "off")], tools)).toEqual({ kind: "none" });
  });

  it("names the agents that have it, and says when only part of the pack is there", () => {
    const summary = summarizeAgents([skill("a", "claude"), skill("b", "claude", "cursor")], tools)!;
    expect(summary).toEqual({ kind: "some", names: ["Claude Code", "Cursor"], partial: true, count: 2, total: 3 });
    expect(agentSummaryText(summary, t)).toBe('mySkills.agents.partly:{"agents":"Claude Code + Cursor"}');
  });

  it("counts instead of naming past two agents", () => {
    const four = [...tools, tool("gem", "Gemini")];
    const summary = summarizeAgents([skill("a", "claude", "cursor", "codex")], four)!;
    expect(agentSummaryText(summary, t)).toBe('mySkills.agents.count:{"count":3,"total":4}');
  });

  it("has nothing to say without skills or agents", () => {
    expect(summarizeAgents([], tools)).toBeNull();
    expect(summarizeAgents([skill("a")], [tool("off", "Off", false)])).toBeNull();
  });
});
