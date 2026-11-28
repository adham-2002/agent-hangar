import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  FolderInput,
  Gauge,
  Inbox,
  LayoutGrid,
  Layers,
  ListTree,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import { useApp } from "../context/AppContext";
import { CLAUDE_CODE, useInsights } from "../context/InsightsContext";
import * as api from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { getSkillSourceInfo } from "../lib/skillSource";
import { formatTokens, UNUSED_DAYS, type BudgetItem, type ProjectOnlyCandidate } from "../lib/insights";
import type { InsightAction } from "../lib/insightsActions";
import { presetLoad } from "../lib/presetLoad";
import { presetPath } from "../lib/presetRoute";
import { PresetBudgets } from "../components/PresetBudgets";
import { AgentIcon } from "../components/AgentIcon";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusBanner } from "../components/StatusBanner";
import { SkillFindings } from "../components/SkillFindings";
import { SkillEditorDialog, type SkillEditorMode } from "../components/SkillEditorDialog";
import { InsightsInbox, type InboxButton } from "../components/insights/InsightsInbox";
import { ContextMap } from "../components/insights/ContextMap";

type View = "inbox" | "map" | "details";
type DetailTab = "budget" | "presets" | "cleanup" | "quality";
const VIEWS: View[] = ["inbox", "map", "details"];
const TABS: DetailTab[] = ["budget", "presets", "cleanup", "quality"];
const VIEW_KEY = "agent-hangar:insights-view";
const TAB_KEY = "agent-hangar:insights-tab";
const QUALITY_PREVIEW = 8;

/** The value in the URL, else the one last used, else the default. */
function remembered<T extends string>(fromUrl: string | null, key: string, allowed: T[], fallback: T): T {
  if (fromUrl && (allowed as string[]).includes(fromUrl)) return fromUrl as T;
  try {
    const saved = localStorage.getItem(key);
    if (saved && (allowed as string[]).includes(saved)) return saved as T;
  } catch {
    // Storage can be unavailable; the default is fine.
  }
  return fallback;
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A convenience only.
  }
}

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function relativeDays(seconds: number | null, now: number, t: TFunction) {
  if (seconds === null) return t("insights.never");
  const days = Math.floor((now - seconds) / 86_400);
  return days <= 0 ? t("insights.today") : t("insights.daysAgo", { count: days });
}

/**
 * Insights in three views of the same figures: an Inbox of what is worth
 * doing (the default), a Map of what each agent loads, and Details with the
 * full tables, one section at a time.
 */
export function Insights() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { managedSkills: skills, refreshManagedSkills, refreshProjects } = useApp();
  const {
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
    budgets,
    presetRows,
    claude,
    unused,
    unusedIds,
    top,
    projectOnly,
    problems,
    tips,
    actions,
    tooEarly,
  } = useInsights();

  const [searchParams, setSearchParams] = useSearchParams();
  const view = remembered(searchParams.get("view"), VIEW_KEY, VIEWS, "inbox");
  const tab = remembered(searchParams.get("tab"), TAB_KEY, TABS, "budget");
  const [open, setOpen] = useState<Record<string, boolean>>({ [CLAUDE_CODE]: true });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [moving, setMoving] = useState<ProjectOnlyCandidate | null>(null);
  const [removing, setRemoving] = useState<{ item: BudgetItem; agentKey: string } | null>(null);
  const [showTips, setShowTips] = useState(false);
  const [showAllProblems, setShowAllProblems] = useState(false);
  const [editor, setEditor] = useState<SkillEditorMode | null>(null);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const go = (next: { view?: View; tab?: DetailTab }) => {
    if (next.view) remember(VIEW_KEY, next.view);
    if (next.tab) remember(TAB_KEY, next.tab);
    setSearchParams(
      (params) => {
        if (next.view) params.set("view", next.view);
        if (next.tab) params.set("tab", next.tab);
        return params;
      },
      { replace: true },
    );
  };

  const dot = (key: string) => colorMap.get(key) ?? "bg-surface-active";
  const maxTotal = Math.max(1, ...budgets.map((b) => b.total));
  const pickedItems = unused.filter((i) => picked.has(i.id));
  const pickedTokens = pickedItems.reduce((n, i) => n + i.alwaysOn, 0);
  const problemIds = useMemo(() => new Set(problems.map((p) => p.skill.id)), [problems]);
  const heaviest = budgets.reduce<(typeof budgets)[number] | null>((m, b) => (!m || b.total > m.total ? b : m), null);
  const sinceLabel = report?.since ? new Date(report.since * 1000).toLocaleDateString(i18n.language) : null;

  const refreshAll = async () => {
    await Promise.all([refreshManagedSkills(), inventory.reload(), load()]);
  };

  const cleanUp = async (items: BudgetItem[]) => {
    let done = 0;
    let failed = 0;
    for (const item of items) {
      try {
        if (item.kind === "skill") {
          await api.unsyncSkillFromTool(item.id, CLAUDE_CODE);
        } else {
          const plugin = inventory.plugins.find((p) => p.id === item.id);
          if (!plugin || !(await inventory.setEnabled(plugin, false))) throw new Error("plugin");
        }
        done++;
      } catch {
        failed++;
      }
    }
    if (done > 0) toast.success(t("insights.unused.cleaned", { count: done }));
    if (failed > 0) toast.error(t("insights.unused.cleanFailed", { count: failed }));
    setPicked(new Set());
    await refreshAll();
  };

  const removeFromAgent = async (item: BudgetItem, agentKey: string) => {
    try {
      if (item.kind === "skill") {
        await api.unsyncSkillFromTool(item.id, agentKey);
      } else {
        const plugin = inventory.plugins.find((p) => p.id === item.id);
        if (!plugin || !(await inventory.setEnabled(plugin, false))) throw new Error("plugin");
      }
      toast.success(t("insights.map.removed", { name: item.name }));
    } catch (e) {
      toast.error(getErrorMessage(e, t("insights.map.removeFailed")));
    }
    await refreshAll();
  };

  // Into the project first, out of Claude Code after: a failure part way
  // leaves the skill in both places, never in neither.
  const moveToProject = async (candidate: ProjectOnlyCandidate) => {
    try {
      const projectId = candidate.projectId ?? (await api.addProject(candidate.projectPath)).id;
      await api.exportSkillToProject(candidate.item.id, projectId, [CLAUDE_CODE]);
      await api.unsyncSkillFromTool(candidate.item.id, CLAUDE_CODE);
      toast.success(
        t("insights.projectOnly.moved", { name: candidate.item.name, project: folderName(candidate.projectPath) }),
      );
    } catch (e) {
      toast.error(getErrorMessage(e, t("insights.projectOnly.moveFailed")));
    }
    await Promise.all([refreshManagedSkills(), refreshProjects?.(), load()]);
  };

  // ── Building blocks shared by the Inbox and Details views ──

  const qualityList = (rows: typeof problems) => (
    <ul className="flex flex-col gap-2">
      {rows.map(({ skill, findings }) => (
        <li key={skill.id} className="rounded-xl border border-border-subtle bg-surface p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium text-primary">{skill.name}</span>
            <button
              type="button"
              onClick={() => setEditor({ kind: "edit", skill })}
              className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-[12px] font-medium text-accent-light transition-colors hover:bg-accent-bg"
            >
              {t("insights.quality.edit")}
            </button>
          </div>
          <SkillFindings findings={findings} />
        </li>
      ))}
    </ul>
  );

  const problemsList = () => (
    <div className="flex flex-col gap-2">
      {qualityList(showAllProblems ? problems : problems.slice(0, QUALITY_PREVIEW))}
      {problems.length > QUALITY_PREVIEW ? (
        <button
          type="button"
          onClick={() => setShowAllProblems((v) => !v)}
          className="self-start text-[12px] font-medium text-accent-light outline-none hover:underline"
        >
          {showAllProblems ? t("mySkills.packCard.less") : t("insights.quality.showAll", { count: problems.length })}
        </button>
      ) : null}
    </div>
  );

  const unusedList = () => (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {unused.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={picked.has(item.id)}
                onChange={() =>
                  setPicked((s) => {
                    const next = new Set(s);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
              />
              <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", dot(item.colorKey))} />
              <span className="min-w-0 truncate text-primary">{item.name}</span>
              <span className="ml-auto shrink-0 text-[12px] text-muted">
                {t("insights.unused.cost", { tokens: formatTokens(item.alwaysOn) })}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPicked(picked.size === unused.length ? new Set() : new Set(unused.map((i) => i.id)))}
          className="app-button-secondary"
        >
          {picked.size === unused.length ? t("mySkills.deselectAll") : t("mySkills.selectAll")}
        </button>
        <button
          type="button"
          disabled={pickedItems.length === 0}
          onClick={() => setConfirmCleanup(true)}
          className="app-button-secondary"
        >
          {t("insights.unused.cleanUp", { count: pickedItems.length, tokens: formatTokens(pickedTokens) })}
        </button>
      </div>
    </div>
  );

  const projectOnlyList = () => (
    <ul className="flex flex-col gap-1.5">
      {projectOnly.map((candidate) => (
        <li key={candidate.item.id} className="flex items-center gap-2 text-[13px]">
          <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", dot(candidate.item.colorKey))} />
          <span className="min-w-0 truncate text-primary">{candidate.item.name}</span>
          <span className="min-w-0 truncate text-[12px] text-muted" title={candidate.projectPath}>
            {t("insights.projectOnly.onlyIn", { project: folderName(candidate.projectPath) })}
          </span>
          <span className="ml-auto shrink-0 text-[12px] text-muted">
            {t("insights.unused.cost", { tokens: formatTokens(candidate.item.alwaysOn) })}
          </span>
          <button type="button" onClick={() => setMoving(candidate)} className="app-button-secondary shrink-0">
            {t("insights.projectOnly.move")}
          </button>
        </li>
      ))}
    </ul>
  );

  // ── Inbox ──

  const inboxDetails = (action: InsightAction) => {
    if (action.kind === "unused") return unusedList();
    if (action.kind === "projectOnly") return projectOnlyList();
    if (action.kind === "quality") return problemsList();
    return null;
  };

  const inboxButtons = (action: InsightAction): InboxButton[] => {
    switch (action.kind) {
      case "unused":
        return [
          {
            label: t("insights.inbox.removeAll"),
            onClick: () => {
              setPicked(new Set(unused.map((i) => i.id)));
              setConfirmCleanup(true);
            },
          },
        ];
      case "heavyPreset":
      case "presetClash":
        return [
          { label: t("insights.inbox.openPreset"), onClick: () => navigate(presetPath(action.presetId!)) },
          { label: t("insights.inbox.inDetails"), onClick: () => go({ view: "details", tab: "presets" }) },
        ];
      default:
        return [];
    }
  };

  // ── Details: tiles, one section at a time ──

  const heavyPresets = presetRows.filter((p) => presetLoad(p.total) === "heavy").length;
  const clashingPresets = presetRows.filter((p) => p.clashes > 0).length;
  const cleanupCount = unused.length + projectOnly.length;
  const cleanupTokens =
    unused.reduce((n, i) => n + i.alwaysOn, 0) + projectOnly.reduce((n, c) => n + c.item.alwaysOn, 0);
  const tiles: { key: DetailTab; label: string; icon: typeof Gauge; value: string; sub: string; attention: boolean }[] = [
    {
      key: "budget",
      label: t("insights.tabs.budget"),
      icon: Gauge,
      value: heaviest ? formatTokens(heaviest.total) : "–",
      sub: heaviest ? t("insights.tabs.budgetSub", { agent: heaviest.tool.display_name }) : t("insights.budget.empty"),
      attention: false,
    },
    {
      key: "presets",
      label: t("insights.tabs.presets"),
      icon: Layers,
      value: String(presetRows.length),
      sub:
        heavyPresets + clashingPresets > 0
          ? t("insights.tabs.presetsSub", { heavy: heavyPresets, clashes: clashingPresets })
          : t("insights.tabs.presetsOk"),
      attention: heavyPresets + clashingPresets > 0,
    },
    {
      key: "cleanup",
      label: t("insights.tabs.cleanup"),
      icon: Trash2,
      value: String(cleanupCount),
      sub:
        cleanupCount > 0
          ? t("insights.tabs.cleanupSub", { tokens: formatTokens(cleanupTokens) })
          : report && tooEarly
            ? t("insights.tabs.cleanupEarly", { days: UNUSED_DAYS })
            : t("insights.tabs.cleanupOk"),
      attention: cleanupCount > 0,
    },
    {
      key: "quality",
      label: t("insights.tabs.quality"),
      icon: ShieldCheck,
      value: quality === null ? "…" : String(problems.length),
      sub: problems.length > 0 ? t("insights.tabs.qualitySub") : t("insights.tabs.qualityOk"),
      attention: problems.length > 0,
    },
  ];

  const budgetSection = () => (
    <section aria-label={t("insights.budget.title")} className="flex flex-col gap-3">
      <p className="text-[12px] text-muted">{t("insights.budget.hint")}</p>
      {memory && (memory.global_always_on > 0 || memory.projects.length > 0) ? (
        <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
          <Brain className="h-3.5 w-3.5" />
          {t("insights.memoryNote", {
            global: formatTokens(memory.global_always_on),
            project: formatTokens(memory.projects.reduce((n, p) => Math.max(n, p.always_on), 0)),
          })}
          <Link to="/memory" className="font-medium text-accent-light hover:underline">
            {t("insights.memoryLink")}
          </Link>
        </p>
      ) : null}
      {budgets.length === 0 ? (
        <p className="text-[13px] text-muted">{t("insights.budget.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {budgets.map((budget) => {
            const expanded = open[budget.tool.key] ?? false;
            return (
              <li key={budget.tool.key} className="rounded-xl border border-border-subtle bg-surface p-3">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen((o) => ({ ...o, [budget.tool.key]: !expanded }))}
                  className="flex w-full items-center gap-2 text-left outline-none"
                >
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                  )}
                  <AgentIcon agentKey={budget.tool.key} className="h-4 w-4 shrink-0" />
                  <span className="truncate text-[13px] font-medium text-primary">{budget.tool.display_name}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-secondary">
                    {t("insights.budget.total", { tokens: formatTokens(budget.total) })}
                  </span>
                </button>
                {/* The bar is scaled to the heaviest agent, so agents compare. */}
                <div
                  className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-hover"
                  style={{ width: `${Math.max(4, (budget.total / maxTotal) * 100)}%` }}
                  role="img"
                  aria-label={t("insights.budget.total", { tokens: formatTokens(budget.total) })}
                >
                  {budget.items
                    .filter((i) => i.alwaysOn > 0)
                    .map((item) => (
                      <span
                        key={item.id}
                        title={`${item.name} · ${formatTokens(item.alwaysOn)}`}
                        className={cn("h-full border-r border-surface last:border-r-0", dot(item.colorKey))}
                        style={{ width: `${(item.alwaysOn / budget.total) * 100}%` }}
                      />
                    ))}
                </div>
                {expanded ? (
                  <table className="mt-3 w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1 font-medium">{t("insights.budget.item")}</th>
                        <th className="py-1 text-right font-medium">{t("insights.budget.alwaysOn")}</th>
                        <th className="py-1 text-right font-medium">{t("insights.budget.onInvoke")}</th>
                        {budget.tracksUsage ? (
                          <th className="py-1 text-right font-medium">{t("insights.budget.uses30")}</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {budget.items.map((item) => (
                        <tr key={item.id} className="border-t border-border-subtle text-secondary">
                          <td className="py-1.5">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", dot(item.colorKey))} />
                              <span className="truncate">{item.name}</span>
                              {item.kind === "plugin" ? (
                                <span className="shrink-0 rounded-full border border-border-subtle px-1.5 text-[11px] text-muted">
                                  {t("mySkills.pluginPacks.badge")}
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {formatTokens(item.alwaysOn)}
                            {item.exact ? "" : "*"}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{formatTokens(item.onInvoke)}*</td>
                          {budget.tracksUsage ? (
                            <td className="py-1.5 text-right tabular-nums">{item.usage?.last30Days ?? 0}</td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] text-muted">{t("insights.budget.footnote")}</p>
    </section>
  );

  const presetsSection = () => (
    <section aria-label={t("insights.presets.title")} className="flex flex-col gap-3">
      <p className="text-[12px] text-muted">{t("insights.presets.hint")}</p>
      <PresetBudgets
        budgets={presetRows}
        dot={(skill) => dot(getSkillSourceInfo(skill).key)}
        onEdit={(skill) => setEditor({ kind: "edit", skill })}
        tracksUsage={report !== null && report.sessions > 0}
      />
    </section>
  );

  const cleanupSection = () => (
    <div className="flex flex-col gap-6">
      {report && claude ? (
        <section aria-label={t("insights.unused.title")} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-primary">
            <Trash2 className="h-4 w-4 text-muted" />
            {t("insights.unused.title", { days: UNUSED_DAYS })}
          </h2>
          {unused.length === 0 ? (
            <p className="text-[12px] text-muted">
              {tooEarly ? t("insights.unused.tooEarly", { days: UNUSED_DAYS }) : t("insights.unused.none")}
            </p>
          ) : (
            <>
              <p className="text-[12px] text-muted">{t("insights.unused.hint")}</p>
              {unusedList()}
            </>
          )}
        </section>
      ) : null}
      {projectOnly.length > 0 ? (
        <section aria-label={t("insights.projectOnly.title")} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-primary">
            <FolderInput className="h-4 w-4 text-muted" />
            {t("insights.projectOnly.title")}
          </h2>
          <p className="text-[12px] text-muted">{t("insights.projectOnly.hint")}</p>
          {projectOnlyList()}
        </section>
      ) : null}
      {report ? (
        <section aria-label={t("insights.usage.title")} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-primary">
            <Sparkles className="h-4 w-4 text-muted" />
            {t("insights.usage.title")}
          </h2>
          <p className="text-[12px] text-muted">
            {sinceLabel
              ? t("insights.usage.source", { count: report.sessions, since: sinceLabel })
              : t("insights.usage.noData")}
          </p>
          {top.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {top.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-[13px]">
                  <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", dot(item.colorKey))} />
                  <span className="min-w-0 truncate text-primary">{item.name}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-muted">
                    {t("insights.usage.row", {
                      count: item.usage?.last30Days ?? 0,
                      total: item.usage?.uses ?? 0,
                      last: relativeDays(item.usage?.lastUsed ?? null, now, t),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <p className="text-[13px] text-muted">{t("insights.usage.noData")}</p>
      )}
    </div>
  );

  const qualitySection = () => (
    <section aria-label={t("insights.quality.title")} className="flex flex-col gap-3 pb-8">
      <p className="text-[12px] text-muted">{t("insights.quality.hint")}</p>
      {quality === null ? (
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("insights.quality.checking")}
        </div>
      ) : (
        <>
          {problems.length === 0 ? (
            <p className="text-[12px] text-muted">{t("insights.quality.none", { count: skills.length })}</p>
          ) : (
            problemsList()
          )}
          {tips.length > 0 ? (
            <>
              <button
                type="button"
                aria-expanded={showTips}
                onClick={() => setShowTips((v) => !v)}
                className="flex items-center gap-1 self-start text-[12px] text-muted outline-none hover:text-secondary"
              >
                {showTips ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {t("insights.quality.tips", { count: tips.length })}
              </button>
              {showTips ? qualityList(tips) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );

  const viewButtons: { key: View; icon: typeof Inbox; label: string; badge?: number }[] = [
    { key: "inbox", icon: Inbox, label: t("insights.views.inbox"), badge: actions.length },
    { key: "map", icon: LayoutGrid, label: t("insights.views.map") },
    { key: "details", icon: ListTree, label: t("insights.views.details") },
  ];

  return (
    <div className="app-page">
      <div className="app-page-header flex flex-wrap items-center justify-between gap-3 pr-2">
        <div>
          <h1 className="app-page-title">{t("insights.title")}</h1>
          <p className="app-page-subtitle">{t("insights.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label={t("insights.views.label")}
            className="flex rounded-lg border border-border-subtle p-0.5"
          >
            {viewButtons.map((v) => {
              const Icon = v.icon;
              return (
                <button
                  key={v.key}
                  type="button"
                  role="tab"
                  aria-selected={view === v.key}
                  data-view={v.key}
                  onClick={() => go({ view: v.key })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium outline-none transition-colors",
                    view === v.key ? "bg-surface-active text-primary" : "text-muted hover:text-secondary",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {v.label}
                  {v.badge ? (
                    <span className="rounded-full bg-amber-500/15 px-1.5 text-[11px] tabular-nums text-amber-700 dark:text-amber-300">
                      {v.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title={t("plugins.refresh")}
            aria-label={t("plugins.refresh")}
            className="rounded-md p-1.5 text-muted transition-colors outline-none hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {error !== null ? (
        <StatusBanner
          tone="danger"
          title={t("insights.loadFailed")}
          description={error || undefined}
          actionLabel={t("common.retry")}
          onAction={() => void load()}
        />
      ) : null}

      {loading && !costs ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("insights.loading")}
        </div>
      ) : null}

      {costs && view === "inbox" ? (
        <InsightsInbox
          actions={actions}
          summary={heaviest ? { agent: heaviest.tool.display_name, tokens: heaviest.total } : null}
          details={inboxDetails}
          buttons={inboxButtons}
          onSeeMap={() => go({ view: "map" })}
        />
      ) : null}

      {costs && view === "map" ? (
        <ContextMap
          budgets={budgets}
          colorMap={colorMap}
          packLabels={packLabels}
          unusedIds={unusedIds}
          problemIds={problemIds}
          onRemove={(item, agentKey) => setRemoving({ item, agentKey })}
        />
      ) : null}

      {costs && view === "details" ? (
        <>
          <div role="tablist" aria-label={t("insights.tabs.label")} className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {tiles.map((tile) => {
              const Icon = tile.icon;
              const active = tab === tile.key;
              return (
                <button
                  key={tile.key}
                  type="button"
                  role="tab"
                  data-tab={tile.key}
                  aria-selected={active}
                  onClick={() => go({ tab: tile.key })}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left outline-none transition-colors",
                    active ? "border-accent bg-accent-bg" : "border-border-subtle bg-surface hover:bg-surface-hover",
                  )}
                >
                  <span className="flex w-full items-center gap-1.5 text-[12px] font-medium text-secondary">
                    <Icon className="h-3.5 w-3.5 text-muted" />
                    {tile.label}
                    {tile.attention ? <span aria-hidden className="ml-auto h-2 w-2 rounded-full bg-amber-500" /> : null}
                  </span>
                  <span className="text-[17px] font-semibold tabular-nums text-primary">{tile.value}</span>
                  <span className="text-[11px] text-muted">{tile.sub}</span>
                </button>
              );
            })}
          </div>
          {tab === "budget" ? budgetSection() : null}
          {tab === "presets" ? presetsSection() : null}
          {tab === "cleanup" ? cleanupSection() : null}
          {tab === "quality" ? qualitySection() : null}
        </>
      ) : null}

      <SkillEditorDialog
        mode={editor}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          await Promise.all([refreshManagedSkills(), loadQuality()]);
        }}
      />

      <ConfirmDialog
        open={moving !== null}
        tone="warning"
        title={t("insights.projectOnly.confirmTitle", {
          name: moving?.item.name,
          project: moving ? folderName(moving.projectPath) : "",
        })}
        message={
          t("insights.projectOnly.confirmMessage", {
            tokens: formatTokens(moving?.item.alwaysOn ?? 0),
          }) + (moving && !moving.projectId ? ` ${t("insights.projectOnly.confirmAddsProject")}` : "")
        }
        details={moving ? [moving.projectPath] : undefined}
        confirmLabel={t("insights.projectOnly.move")}
        onClose={() => setMoving(null)}
        onConfirm={async () => {
          const candidate = moving;
          setMoving(null);
          if (candidate) await moveToProject(candidate);
        }}
      />

      <ConfirmDialog
        open={confirmCleanup}
        tone="warning"
        title={t("insights.unused.confirmTitle", { count: pickedItems.length })}
        message={t("insights.unused.confirmMessage")}
        details={pickedItems.map((i) => i.name)}
        confirmLabel={t("insights.unused.confirm")}
        onClose={() => setConfirmCleanup(false)}
        onConfirm={async () => {
          setConfirmCleanup(false);
          await cleanUp(pickedItems);
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        tone="warning"
        title={t("insights.map.confirmTitle", { name: removing?.item.name ?? "" })}
        message={t("insights.map.confirmMessage")}
        confirmLabel={t("insights.map.confirm")}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          const target = removing;
          setRemoving(null);
          if (target) await removeFromAgent(target.item, target.agentKey);
        }}
      />
    </div>
  );
}
