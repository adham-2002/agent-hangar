import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Gauge, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import { useApp } from "../context/AppContext";
import * as api from "../lib/tauri";
import type { ContextCosts, UsageReport } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { buildSourceGroups } from "../lib/skillSource";
import { assignSourceColors } from "../lib/sourceColor";
import { pluginPacks } from "../lib/pluginPacks";
import {
  agentBudgets,
  attributeUsage,
  formatTokens,
  mostUsed,
  unusedItems,
  UNUSED_DAYS,
  type BudgetItem,
} from "../lib/insights";
import { usePluginInventory } from "../hooks/usePluginInventory";
import { AgentIcon } from "../components/AgentIcon";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusBanner } from "../components/StatusBanner";

const CLAUDE_CODE = "claude_code";

function relativeDays(seconds: number | null, now: number, t: TFunction) {
  if (seconds === null) return t("insights.never");
  const days = Math.floor((now - seconds) / 86_400);
  return days <= 0 ? t("insights.today") : t("insights.daysAgo", { count: days });
}

export function Insights() {
  const { t, i18n } = useTranslation();
  const { managedSkills: skills, tools, refreshManagedSkills } = useApp();
  const inventory = usePluginInventory();
  const [report, setReport] = useState<UsageReport | null>(null);
  const [costs, setCosts] = useState<ContextCosts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ [CLAUDE_CODE]: true });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    setLoading(true);
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
  }, []);

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

  const dot = (key: string) => colorMap.get(key) ?? "bg-surface-active";

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
        <section aria-label={t("insights.unused.title")} className="flex flex-col gap-3 pb-8">
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
