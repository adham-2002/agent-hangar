import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  FolderInput,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { homeDir } from "@tauri-apps/api/path";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import { useApp } from "../context/AppContext";
import * as api from "../lib/tauri";
import type { ContextCosts, MemoryReport, SkillQuality, UsageReport } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { buildSourceGroups } from "../lib/skillSource";
import { assignSourceColors } from "../lib/sourceColor";
import { pluginPacks } from "../lib/pluginPacks";
import {
  agentBudgets,
  attributeUsage,
  formatTokens,
  mostUsed,
  projectOnlyCandidates,
  unusedItems,
  UNUSED_DAYS,
  type BudgetItem,
  type ProjectOnlyCandidate,
} from "../lib/insights";
import { usePluginInventory } from "../hooks/usePluginInventory";
import { AgentIcon } from "../components/AgentIcon";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusBanner } from "../components/StatusBanner";
import { SkillFindings } from "../components/SkillFindings";
import { SkillEditorDialog, type SkillEditorMode } from "../components/SkillEditorDialog";

const CLAUDE_CODE = "claude_code";
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function relativeDays(seconds: number | null, now: number, t: TFunction) {
  if (seconds === null) return t("insights.never");
  const days = Math.floor((now - seconds) / 86_400);
  return days <= 0 ? t("insights.today") : t("insights.daysAgo", { count: days });
}

export function Insights() {
  const { t, i18n } = useTranslation();
  const { managedSkills: skills, tools, refreshManagedSkills, projects, refreshProjects } = useApp();
  const inventory = usePluginInventory();
  const [report, setReport] = useState<UsageReport | null>(null);
  const [costs, setCosts] = useState<ContextCosts | null>(null);
  const [quality, setQuality] = useState<SkillQuality[] | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ [CLAUDE_CODE]: true });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [moving, setMoving] = useState<ProjectOnlyCandidate | null>(null);
  const [showTips, setShowTips] = useState(false);
  const [editor, setEditor] = useState<SkillEditorMode | null>(null);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => setHome(null));
  }, []);

  // Separate from the rest, so a failed check never hides the budget.
  const loadQuality = useCallback(async () => {
    try {
      setQuality(await api.checkLibraryQuality());
    } catch {
      setQuality([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
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

  useEffect(() => {
    void load();
  }, [load]);

  // The same colours as Library: one per source, shared with plugins from it.
  const { colorMap, pluginColorKeys } = useMemo(() => {
    const groups = buildSourceGroups(skills);
    const packs = pluginPacks(inventory.plugins, inventory.details);
    return {
      colorMap: assignSourceColors([...groups.map((g) => g.key), ...packs.map((p) => p.colorKey)]),
      pluginColorKeys: new Map(packs.map((p) => [p.plugin.id, p.colorKey])),
    };
  }, [skills, inventory.plugins, inventory.details]);

  const budgets = useMemo(() => {
    if (!costs) return [];
    return agentBudgets({
      skills,
      tools,
      plugins: inventory.plugins,
      skillCosts: new Map(costs.skills.map((s) => [s.id, s.cost])),
      pluginCosts: new Map(costs.plugins.map((p) => [p.id, { cost: p.cost, exact: p.source === "claude" }])),
      pluginColorKeys,
      usage: attributeUsage(report, skills, inventory.plugins, inventory.details),
    });
  }, [costs, report, skills, tools, inventory.plugins, inventory.details, pluginColorKeys]);

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
  const problems = qualityRows.filter((r) => r.worst < SEVERITY_RANK.info);
  const tips = qualityRows.filter((r) => r.worst === SEVERITY_RANK.info);
  const maxTotal = Math.max(1, ...budgets.map((b) => b.total));
  const pickedItems = unused.filter((i) => picked.has(i.id));
  const pickedTokens = pickedItems.reduce((n, i) => n + i.alwaysOn, 0);
  const sinceLabel = report?.since
    ? new Date(report.since * 1000).toLocaleDateString(i18n.language)
    : null;

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
    await Promise.all([refreshManagedSkills(), inventory.reload(), load()]);
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

  const dot = (key: string) => colorMap.get(key) ?? "bg-surface-active";

  const qualityList = (rows: typeof qualityRows) => (
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

  return (
    <div className="app-page">
      <div className="app-page-header flex items-center justify-between gap-3 pr-2">
        <div>
          <h1 className="app-page-title">{t("insights.title")}</h1>
          <p className="app-page-subtitle">{t("insights.subtitle")}</p>
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

      {/* ── Context budget ── */}
      {costs ? (
        <section aria-label={t("insights.budget.title")} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted" />
            <h2 className="text-[14px] font-semibold text-primary">{t("insights.budget.title")}</h2>
          </div>
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
      ) : null}

      {/* ── Used in one project only ── */}
      {projectOnly.length > 0 ? (
        <section aria-label={t("insights.projectOnly.title")} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FolderInput className="h-4 w-4 text-muted" />
            <h2 className="text-[14px] font-semibold text-primary">{t("insights.projectOnly.title")}</h2>
          </div>
          <p className="text-[12px] text-muted">{t("insights.projectOnly.hint")}</p>
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
        </section>
      ) : null}

      {/* ── Usage ── */}
      {report ? (
        <section aria-label={t("insights.usage.title")} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted" />
            <h2 className="text-[14px] font-semibold text-primary">{t("insights.usage.title")}</h2>
          </div>
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
      ) : null}

      {/* ── Unused ── */}
      {report && claude ? (
        <section aria-label={t("insights.unused.title")} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-muted" />
            <h2 className="text-[14px] font-semibold text-primary">
              {t("insights.unused.title", { days: UNUSED_DAYS })}
            </h2>
          </div>
          {unused.length === 0 ? (
            <p className="text-[12px] text-muted">
              {report.since && now - report.since >= UNUSED_DAYS * 86_400
                ? t("insights.unused.none")
                : t("insights.unused.tooEarly", { days: UNUSED_DAYS })}
            </p>
          ) : (
            <>
              <p className="text-[12px] text-muted">{t("insights.unused.hint")}</p>
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
                  onClick={() =>
                    setPicked(picked.size === unused.length ? new Set() : new Set(unused.map((i) => i.id)))
                  }
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
                  {t("insights.unused.cleanUp", {
                    count: pickedItems.length,
                    tokens: formatTokens(pickedTokens),
                  })}
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {/* ── Quality ── */}
      <section aria-label={t("insights.quality.title")} className="flex flex-col gap-3 pb-8">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted" />
          <h2 className="text-[14px] font-semibold text-primary">{t("insights.quality.title")}</h2>
        </div>
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
              qualityList(problems)
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
    </div>
  );
}
