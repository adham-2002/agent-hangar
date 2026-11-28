/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { useApp } from "./AppContext";
import * as api from "../lib/tauri";
import type { ContextCosts, MemoryReport, PresetQuality, SkillQuality, UsageReport } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { buildSourceGroups } from "../lib/skillSource";
import { assignSourceColors } from "../lib/sourceColor";
import { pluginPacks } from "../lib/pluginPacks";
import {
  agentBudgets,
  attributeUsage,
  mostUsed,
  presetBudgets,
  projectOnlyCandidates,
  unusedItems,
  UNUSED_DAYS,
} from "../lib/insights";
import { buildActions } from "../lib/insightsActions";
import { usePluginInventory } from "../hooks/usePluginInventory";

export const CLAUDE_CODE = "claude_code";
export const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

/** The first load waits a moment, so starting the app stays quick. */
const STARTUP_DELAY_MS = 2500;

function useInsightsState() {
  const { managedSkills: skills, tools, projects, presets } = useApp();
  const inventory = usePluginInventory();
  const [report, setReport] = useState<UsageReport | null>(null);
  const [costs, setCosts] = useState<ContextCosts | null>(null);
  const [quality, setQuality] = useState<SkillQuality[] | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemoryReport | null>(null);
  const [presetQuality, setPresetQuality] = useState<PresetQuality[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const started = useRef(false);

  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => setHome(null));
  }, []);

  // Separate from the rest, so a failed check never hides the budget.
  const loadQuality = useCallback(async () => {
    void api
      .checkPresetQuality()
      .then(setPresetQuality)
      .catch(() => setPresetQuality([]));
    try {
      setQuality(await api.checkLibraryQuality());
    } catch {
      setQuality([]);
    }
  }, []);

  const load = useCallback(async () => {
    started.current = true;
    setLoading(true);
    setNow(Math.floor(Date.now() / 1000));
    void loadQuality();
    // Optional, like the quality check: the budget never waits on it.
    api
      .getAgentMemory()
      .then(setMemory)
      .catch(() => setMemory(null));
    try {
      const [usage, contextCosts] = await Promise.all([api.getSkillUsage(), api.getContextCosts()]);
      setReport(usage);
      setCosts(contextCosts);
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e, ""));
    } finally {
      setLoading(false);
    }
  }, [loadQuality]);

  /** Loads now unless a load already ran; the Insights page calls it on open. */
  const ensureLoaded = useCallback(() => {
    if (!started.current) void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(ensureLoaded, STARTUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ensureLoaded]);

  // The same colours as Library: one per source, shared with plugins from it.
  const { colorMap, pluginColorKeys, packLabels } = useMemo(() => {
    const groups = buildSourceGroups(skills);
    const packs = pluginPacks(inventory.plugins, inventory.details);
    const labels = new Map<string, string>();
    for (const g of groups) labels.set(g.key, g.label ?? g.skills[0]?.name ?? g.key);
    for (const p of packs) if (!labels.has(p.colorKey)) labels.set(p.colorKey, p.plugin.name);
    return {
      colorMap: assignSourceColors([...groups.map((g) => g.key), ...packs.map((p) => p.colorKey)]),
      pluginColorKeys: new Map(packs.map((p) => [p.plugin.id, p.colorKey])),
      packLabels: labels,
    };
  }, [skills, inventory.plugins, inventory.details]);

  const usage = useMemo(
    () => attributeUsage(report, skills, inventory.plugins, inventory.details),
    [report, skills, inventory.plugins, inventory.details],
  );

  const budgets = useMemo(() => {
    if (!costs) return [];
    return agentBudgets({
      skills,
      tools,
      plugins: inventory.plugins,
      skillCosts: new Map(costs.skills.map((s) => [s.id, s.cost])),
      pluginCosts: new Map(costs.plugins.map((p) => [p.id, { cost: p.cost, exact: p.source === "claude" }])),
      pluginColorKeys,
      usage,
    });
  }, [costs, skills, tools, inventory.plugins, pluginColorKeys, usage]);

  const presetRows = useMemo(() => {
    if (!costs) return [];
    return presetBudgets({
      presets: presets ?? [],
      skills,
      skillCosts: new Map(costs.skills.map((s) => [s.id, s.cost])),
      quality: new Map((quality ?? []).map((q) => [q.skill_id, q.findings])),
      presetQuality,
      usageBySkill: report ? usage.bySkill : null,
      report,
      nowSeconds: now,
    });
  }, [costs, presets, skills, quality, presetQuality, report, usage, now]);

  const claude = budgets.find((b) => b.tracksUsage);
  const unused = useMemo(() => unusedItems(claude, report, skills, now), [claude, report, skills, now]);
  const top = useMemo(() => mostUsed(claude), [claude]);
  const projectOnly = useMemo(
    () => projectOnlyCandidates(claude, report, projects ?? [], home, now),
    [claude, report, projects, home, now],
  );
  const qualityRows = useMemo(() => {
    const byId = new Map(skills.map((s) => [s.id, s]));
    return (quality ?? [])
      .flatMap((q) => {
        const skill = byId.get(q.skill_id);
        if (!skill) return [];
        const worst = Math.min(...q.findings.map((f) => SEVERITY_RANK[f.severity]));
        return [{ skill, findings: q.findings, worst }];
      })
      .sort((a, b) => a.worst - b.worst || a.skill.name.localeCompare(b.skill.name));
  }, [quality, skills]);
  const problems = useMemo(() => qualityRows.filter((r) => r.worst < SEVERITY_RANK.info), [qualityRows]);
  const tips = useMemo(() => qualityRows.filter((r) => r.worst === SEVERITY_RANK.info), [qualityRows]);
  const actions = useMemo(
    () => buildActions({ unused, projectOnly, presets: presetRows, problems }),
    [unused, projectOnly, presetRows, problems],
  );
  /** Skills and plugins Claude Code loads but has not used in 30 days. */
  const unusedIds = useMemo(() => new Set(unused.map((i) => i.id)), [unused]);
  /** Library skills Claude Code loads but has not used in 30 days. */
  const unusedSkillIds = useMemo(
    () => new Set(unused.filter((i) => i.kind === "skill").map((i) => i.id)),
    [unused],
  );
  const tooEarly = !report?.since || now - report.since < UNUSED_DAYS * 86_400;

  return {
    inventory,
    report,
    costs,
    quality,
    memory,
    loading,
    error,
    now,
    load,
    loadQuality,
    ensureLoaded,
    colorMap,
    packLabels,
    usage,
    budgets,
    presetRows,
    claude,
    unused,
    unusedIds,
    unusedSkillIds,
    top,
    projectOnly,
    qualityRows,
    problems,
    tips,
    actions,
    tooEarly,
  };
}

export type InsightsState = ReturnType<typeof useInsightsState>;

const InsightsContext = createContext<InsightsState | null>(null);

export function InsightsProvider({ children }: { children: ReactNode }) {
  const value = useInsightsState();
  return <InsightsContext.Provider value={value}>{children}</InsightsContext.Provider>;
}

export function useInsights(): InsightsState {
  const value = useContext(InsightsContext);
  if (!value) throw new Error("useInsights must be used inside InsightsProvider");
  return value;
}

/** For places that only decorate with insights (sidebar, Library). */
export function useOptionalInsights(): InsightsState | null {
  return useContext(InsightsContext);
}
