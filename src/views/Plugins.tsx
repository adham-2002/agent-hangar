import { useMemo, useState } from "react";
import { Loader2, Puzzle, RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import type { PluginDetail, PluginInfo } from "../lib/tauri";
import { usePluginInventory } from "../hooks/usePluginInventory";
import { DetailSheet } from "../components/DetailSheet";
import { StatusBanner } from "../components/StatusBanner";
import { ToggleSwitch } from "../components/ToggleSwitch";

function bundleTotal(detail: PluginDetail | undefined) {
  if (!detail) return null;
  return {
    skills: detail.skills.length,
    commands: detail.commands.length,
    agents: detail.agents.length,
    mcp: detail.mcp_servers.length,
  };
}

function NameList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-[13px] font-medium text-secondary">
        {title} ({items.length})
      </h3>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((name) => (
          <li
            key={name}
            className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[12px] text-secondary"
          >
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Plugins() {
  const { t } = useTranslation();
  const { plugins, details, loading, loadError, pending, reload: load, setEnabled } =
    usePluginInventory();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const toggle = (plugin: PluginInfo) => setEnabled(plugin, !plugin.enabled);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plugins;
    return plugins.filter((p) => `${p.name} ${p.marketplace}`.toLowerCase().includes(q));
  }, [plugins, query]);

  const selected = plugins.find((p) => p.id === selectedId) ?? null;
  const selectedDetail = selected ? details[selected.id] : undefined;

  return (
    <div className="app-page">
      <div className="app-page-header flex items-center justify-between gap-3 pr-2">
        <div>
          <h1 className="app-page-title">{t("plugins.title")}</h1>
          <p className="app-page-subtitle">{t("plugins.subtitle")}</p>
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

      {loadError ? (
        <StatusBanner
          tone="danger"
          title={t("plugins.loadFailed")}
          description={loadError}
          actionLabel={t("common.retry")}
          onAction={() => void load()}
        />
      ) : null}

      <p className="text-[12px] text-muted">{t("plugins.appliesToNewSessions")}</p>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("plugins.searchPlaceholder")}
          aria-label={t("plugins.searchPlaceholder")}
          className="h-9 w-full rounded-lg border border-border-subtle bg-background pr-3 pl-9 text-[13px] text-secondary outline-none focus:border-border"
        />
      </div>

      {loading && plugins.length === 0 ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : plugins.length === 0 && !loadError ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border-subtle bg-surface p-10 text-center">
          <Puzzle className="h-6 w-6 text-muted" />
          <p className="text-[14px] font-medium text-primary">{t("plugins.empty")}</p>
          <p className="text-[13px] text-muted">{t("plugins.emptyHint")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-[13px] text-muted">{t("plugins.noMatch")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((plugin) => {
            const totals = bundleTotal(details[plugin.id]);
            return (
              <li
                key={plugin.id}
                className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3"
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(plugin.id)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left outline-none"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-primary">
                      {plugin.name}
                    </span>
                    {plugin.version ? (
                      <span className="text-[12px] text-muted">{plugin.version}</span>
                    ) : null}
                    <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-muted">
                      {plugin.scope}
                    </span>
                    {!plugin.installed ? (
                      <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-300">
                        {t("plugins.notInstalled")}
                      </span>
                    ) : !plugin.files_present ? (
                      <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-300">
                        {t("plugins.filesMissing")}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-[12px] text-muted">
                    {plugin.marketplace}
                    {totals
                      ? ` · ${t("plugins.skillsCount", { count: totals.skills })} · ${t("plugins.commandsCount", { count: totals.commands })} · ${t("plugins.agentsCount", { count: totals.agents })} · ${t("plugins.mcpCount", { count: totals.mcp })}`
                      : ""}
                  </span>
                </button>
                <ToggleSwitch
                  checked={plugin.enabled}
                  onChange={() => void toggle(plugin)}
                  loading={pending.has(plugin.id)}
                  disabled={pending.has(plugin.id)}
                  title={t("plugins.toggleTitle", { name: plugin.name })}
                />
              </li>
            );
          })}
        </ul>
      )}

      <DetailSheet
        open={selected !== null}
        title={selected?.name ?? ""}
        description={selectedDetail?.description ?? undefined}
        meta={
          selected ? (
            <p className="text-[12px] text-muted">
              {selected.marketplace}
              {selected.version ? ` · ${selected.version}` : ""}
              {selectedDetail?.author ? ` · ${selectedDetail.author}` : ""}
            </p>
          ) : null
        }
        onClose={() => setSelectedId(null)}
      >
        {selected && !selected.files_present ? (
          <p className="text-[13px] text-muted">{t("plugins.filesMissingHint")}</p>
        ) : selectedDetail ? (
          <>
            <NameList title={t("plugins.detail.skills")} items={selectedDetail.skills} />
            <NameList title={t("plugins.detail.commands")} items={selectedDetail.commands} />
            <NameList title={t("plugins.detail.agents")} items={selectedDetail.agents} />
            <NameList title={t("plugins.detail.mcp")} items={selectedDetail.mcp_servers} />
            {selectedDetail.hooks ? (
              <p className="text-[13px] text-secondary">{t("plugins.detail.hooks")}</p>
            ) : null}
          </>
        ) : null}
      </DetailSheet>
    </div>
  );
}
