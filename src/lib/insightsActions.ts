/**
 * The Insights inbox: what is worth doing about the agents' setup, as a short
 * list ordered by what it gains. Built from the same figures the Details view
 * shows, so the two never disagree.
 */
import type { ManagedSkill } from "./tauri";
import type { BudgetItem, PresetBudget, ProjectOnlyCandidate } from "./insights";
import { presetLoad } from "./presetLoad";

export type InsightActionKind = "unused" | "projectOnly" | "heavyPreset" | "presetClash" | "quality";

export interface InsightAction {
  /** Stable across reloads, for keys and remembered state. */
  id: string;
  kind: InsightActionKind;
  /** Tokens it takes out of sessions, or the preset's weight; 0 when unknown. */
  tokens: number;
  /** How many skills or presets it concerns. */
  count: number;
  /** A few names to show on the card. */
  names: string[];
  presetId?: string;
  /** Quality: skills with an error (the rest have warnings). */
  errors?: number;
  /** Preset: skills in it that clash with each other. */
  clashes?: number;
}

/** Equal gains are shown in this order: what costs every session first. */
const KIND_ORDER: Record<InsightActionKind, number> = {
  unused: 0,
  projectOnly: 1,
  heavyPreset: 2,
  quality: 3,
  presetClash: 4,
};

export interface QualityProblem {
  skill: ManagedSkill;
  /** 0 for an error, 1 for a warning. */
  worst: number;
}

export function buildActions(input: {
  unused: BudgetItem[];
  projectOnly: ProjectOnlyCandidate[];
  presets: PresetBudget[];
  problems: QualityProblem[];
}): InsightAction[] {
  const actions: InsightAction[] = [];
  if (input.unused.length) {
    actions.push({
      id: "unused",
      kind: "unused",
      tokens: input.unused.reduce((n, i) => n + i.alwaysOn, 0),
      count: input.unused.length,
      names: input.unused.map((i) => i.name),
    });
  }
  if (input.projectOnly.length) {
    actions.push({
      id: "projectOnly",
      kind: "projectOnly",
      tokens: input.projectOnly.reduce((n, c) => n + c.item.alwaysOn, 0),
      count: input.projectOnly.length,
      names: input.projectOnly.map((c) => c.item.name),
    });
  }
  for (const p of input.presets) {
    if (presetLoad(p.total) === "heavy") {
      actions.push({
        id: `heavy:${p.preset.id}`,
        kind: "heavyPreset",
        tokens: p.total,
        count: p.rows.length,
        names: [p.preset.name],
        presetId: p.preset.id,
        clashes: p.clashes,
      });
    } else if (p.clashes > 0) {
      actions.push({
        id: `clash:${p.preset.id}`,
        kind: "presetClash",
        tokens: 0,
        count: p.clashes,
        names: [p.preset.name],
        presetId: p.preset.id,
        clashes: p.clashes,
      });
    }
  }
  if (input.problems.length) {
    actions.push({
      id: "quality",
      kind: "quality",
      tokens: 0,
      count: input.problems.length,
      names: input.problems.map((p) => p.skill.name),
      errors: input.problems.filter((p) => p.worst === 0).length,
    });
  }
  return actions.sort((a, b) => b.tokens - a.tokens || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/** The few names a card shows, and how many more there are. */
export function previewNames(names: string[], max = 3): { shown: string[]; more: number } {
  return { shown: names.slice(0, max), more: Math.max(0, names.length - max) };
}
