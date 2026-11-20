import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Plus, Puzzle, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import * as api from "../lib/tauri";
import type { CatalogEntry, MarketplaceInfo, PluginDetail, PluginInfo } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { CATALOG_PAGE, searchCatalog } from "../lib/pluginCatalog";
import { usePluginInventory } from "../hooks/usePluginInventory";
import { usePluginOperations } from "../hooks/usePluginOperations";
import { CardActionMenu } from "../components/CardActionMenu";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DetailSheet } from "../components/DetailSheet";
import { StatusBanner } from "../components/StatusBanner";
import { ToggleSwitch } from "../components/ToggleSwitch";

type Tab = "installed" | "browse" | "marketplaces";
const TABS: Tab[] = ["installed", "browse", "marketplaces"];

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

const inputClass =
  "h-9 w-full rounded-lg border border-border-subtle bg-background px-3 text-[13px] text-secondary outline-none focus:border-border";

export function Plugins() {
  const { t } = useTranslation();
  const { plugins, details, loading, loadError, pending, reload, setEnabled } = usePluginInventory();
  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The claude CLI is needed only for install, update, remove and marketplaces.
  const [cliAvailable, setCliAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api
      .getClaudeCliStatus()
      .then((s) => live && setCliAvailable(s.available))
      .catch(() => live && setCliAvailable(false));
    return () => {
      live = false;
    };
  }, []);

  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseLimit, setBrowseLimit] = useState(CATALOG_PAGE);

  const [markets, setMarkets] = useState<MarketplaceInfo[] | null>(null);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [newMarket, setNewMarket] = useState("");

  const [confirmUninstall, setConfirmUninstall] = useState<PluginInfo | null>(null);
  const [confirmRemoveMarket, setConfirmRemoveMarket] = useState<string | null>(null);

  // Catalog and marketplaces load the first time their tab opens; afterwards
  // a change reloads whichever of them has been loaded.
  const loaded = useRef({ catalog: false, markets: false });

  const loadCatalog = useCallback(async () => {
    loaded.current.catalog = true;
    setCatalogLoading(true);
    try {
      setCatalog(await api.getPluginCatalog());
      setCatalogError(null);
    } catch (e) {
      setCatalogError(getErrorMessage(e, t("common.error")));
    } finally {
      setCatalogLoading(false);
    }
  }, [t]);

  const loadMarkets = useCallback(async () => {
    loaded.current.markets = true;
    setMarketsLoading(true);
    try {
      setMarkets(await api.listMarketplaces());
      setMarketsError(null);
    } catch (e) {
      setMarketsError(getErrorMessage(e, t("common.error")));
    } finally {
      setMarketsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!cliAvailable) return;
    if (tab === "browse" && !loaded.current.catalog) void loadCatalog();
    if (tab === "marketplaces" && !loaded.current.markets) void loadMarkets();
  }, [tab, cliAvailable, loadCatalog, loadMarkets]);

  const ops = usePluginOperations(
    useCallback(async () => {
      await Promise.all([
        reload(),
        loaded.current.catalog ? loadCatalog() : null,
        loaded.current.markets ? loadMarkets() : null,
      ]);
    }, [reload, loadCatalog, loadMarkets])
  );
  const cliReady = cliAvailable === true;
  const opBusy = ops.busyKey !== null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plugins;
    return plugins.filter((p) => `${p.name} ${p.marketplace}`.toLowerCase().includes(q));
  }, [plugins, query]);

  const browseResults = useMemo(
    () => (catalog ? searchCatalog(catalog, browseQuery) : []),
    [catalog, browseQuery]
  );

  const selected = plugins.find((p) => p.id === selectedId) ?? null;
  const selectedDetail = selected ? details[selected.id] : undefined;

  const refreshCurrent = () => {
    if (tab === "installed") void reload();
    if (tab === "browse" && cliReady) void loadCatalog();
    if (tab === "marketplaces" && cliReady) void loadMarkets();
  };
  const refreshing =
    (tab === "installed" && loading) ||
    (tab === "browse" && catalogLoading) ||
    (tab === "marketplaces" && marketsLoading);

  const install = (entry: CatalogEntry) =>
    ops.run(
      `install:${entry.plugin_id}`,
      t("plugins.ops.installLabel", { name: entry.name }),
      t("plugins.ops.installed", { name: entry.name }),
      (accept) => api.installPlugin(entry.plugin_id, accept)
    );

  const update = (plugin: PluginInfo) =>
    ops.run(
      `update:${plugin.id}`,
      t("plugins.ops.updateLabel", { name: plugin.name }),
      t("plugins.ops.updated", { name: plugin.name }),
      (accept) => api.updatePlugin(plugin.id, accept)
    );

  const cliBanner =
    cliAvailable === false ? (
      <StatusBanner title={t("plugins.cli.missing")} description={t("plugins.cli.missingHint")} />
    ) : null;

  return (
    <div className="app-page">
      <div className="app-page-header flex items-center justify-between gap-3 pr-2">
        <div>
          <h1 className="app-page-title">{t("plugins.title")}</h1>
          <p className="app-page-subtitle">{t("plugins.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={refreshCurrent}
          disabled={refreshing}
          title={t("plugins.refresh")}
          aria-label={t("plugins.refresh")}
          className="rounded-md p-1.5 text-muted transition-colors outline-none hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </button>
      </div>

      <div className="app-segmented self-start" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn("app-segmented-button", tab === key && "app-segmented-button-active")}
          >
            {t(`plugins.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === "installed" ? (
        <>
          {loadError ? (
            <StatusBanner
              tone="danger"
              title={t("plugins.loadFailed")}
              description={loadError}
              actionLabel={t("common.retry")}
              onAction={() => void reload()}
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
              className={cn(inputClass, "pl-9")}
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
              {cliReady ? (
                <button type="button" onClick={() => setTab("browse")} className="app-button-secondary mt-2">
                  {t("plugins.browseCta")}
                </button>
              ) : null}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-[13px] text-muted">{t("plugins.noMatch")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((plugin) => {
                const totals = bundleTotal(details[plugin.id]);
                const rowBusy =
                  ops.busyKey === `update:${plugin.id}` || ops.busyKey === `uninstall:${plugin.id}`;
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
                        <span className="truncate text-[14px] font-medium text-primary">{plugin.name}</span>
                        {plugin.version ? (
                          <span className="text-[12px] text-muted">{plugin.version}</span>
                        ) : null}
                        <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-muted">
                          {plugin.scope}
                        </span>
                        {plugin.update_available ? (
                          <span
                            title={t("plugins.updates.hint")}
                            className="rounded-full border border-accent/30 bg-accent-bg px-2 py-0.5 text-[11px] font-medium text-accent"
                          >
                            {plugin.latest_version
                              ? t("plugins.updates.badgeVersion", { version: plugin.latest_version })
                              : t("plugins.updates.badge")}
                          </span>
                        ) : null}
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
                    {rowBusy ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : null}
                    {/* Synced plugins belong to the claude.ai account: shown, not changed here. */}
                    {plugin.scope === "synced" ? (
                      <span
                        title={t("plugins.syncedHint")}
                        className="shrink-0 rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-muted"
                      >
                        {t("plugins.syncedBadge")}
                      </span>
                    ) : (
                      <ToggleSwitch
                        checked={plugin.enabled}
                        onChange={() => void setEnabled(plugin, !plugin.enabled)}
                        loading={pending.has(plugin.id)}
                        disabled={pending.has(plugin.id)}
                        title={t("plugins.toggleTitle", { name: plugin.name })}
                      />
                    )}
                    {plugin.installed && cliReady && plugin.scope !== "synced" ? (
                      <CardActionMenu
                        label={t("plugins.ops.menu", { name: plugin.name })}
                        actions={[
                          {
                            key: "update",
                            label: plugin.update_available
                              ? t("plugins.updates.updateNow")
                              : t("plugins.ops.update"),
                            icon: <RotateCcw className="h-3.5 w-3.5" />,
                            disabled: opBusy,
                            onSelect: () => void update(plugin),
                          },
                          {
                            key: "uninstall",
                            label: t("plugins.ops.uninstall"),
                            icon: <Trash2 className="h-3.5 w-3.5" />,
                            danger: true,
                            disabled: opBusy,
                            onSelect: () => setConfirmUninstall(plugin),
                          },
                        ]}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      {tab === "browse" ? (
        <>
          {cliBanner}
          {catalogError ? (
            <StatusBanner
              tone="danger"
              title={t("plugins.browse.loadFailed")}
              description={catalogError}
              actionLabel={t("common.retry")}
              onAction={() => void loadCatalog()}
            />
          ) : null}
          {cliReady ? (
            <>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    value={browseQuery}
                    onChange={(e) => {
                      setBrowseQuery(e.target.value);
                      setBrowseLimit(CATALOG_PAGE);
                    }}
                    placeholder={t("plugins.browse.searchPlaceholder")}
                    aria-label={t("plugins.browse.searchPlaceholder")}
                    className={cn(inputClass, "pl-9")}
                  />
                </div>
                <button
                  type="button"
                  disabled={opBusy}
                  onClick={() =>
                    void ops.run(
                      "markets:update",
                      t("plugins.browse.refreshCatalogs"),
                      t("plugins.browse.catalogsRefreshed"),
                      () => api.updateMarketplaces()
                    )
                  }
                  className="app-button-secondary shrink-0"
                >
                  {ops.busyKey === "markets:update" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {t("plugins.browse.refreshCatalogs")}
                </button>
              </div>

              {catalog === null ? (
                <div className="flex items-center gap-2 text-[13px] text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("plugins.browse.loading")}
                </div>
              ) : browseResults.length === 0 ? (
                <p className="text-[13px] text-muted">{t("plugins.browse.noMatch")}</p>
              ) : (
                <>
                  <p className="text-[12px] text-muted">
                    {t("plugins.browse.showing", {
                      shown: Math.min(browseLimit, browseResults.length),
                      total: browseResults.length,
                    })}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {browseResults.slice(0, browseLimit).map((entry) => {
                      const busy = ops.busyKey === `install:${entry.plugin_id}`;
                      return (
                        <li
                          key={entry.plugin_id}
                          className="flex items-start gap-3 rounded-xl border border-border-subtle bg-surface p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-[14px] font-medium text-primary">{entry.name}</span>
                              <span className="shrink-0 text-[12px] text-muted">{entry.marketplace}</span>
                              {entry.install_count !== null ? (
                                <span className="shrink-0 text-[12px] text-faint">
                                  {t("plugins.browse.installs", { count: entry.install_count })}
                                </span>
                              ) : null}
                            </p>
                            {entry.description ? (
                              <p className="mt-1 line-clamp-2 text-[12px] text-muted">{entry.description}</p>
                            ) : null}
                          </div>
                          {entry.installed ? (
                            <span className="shrink-0 rounded-full border border-border-subtle px-2 py-0.5 text-[11px] font-medium text-muted">
                              {t("plugins.browse.installed")}
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={opBusy}
                              onClick={() => void install(entry)}
                              className="app-button-secondary shrink-0"
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="h-3.5 w-3.5" />
                              )}
                              {t("plugins.browse.install")}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {browseResults.length > browseLimit ? (
                    <button
                      type="button"
                      onClick={() => setBrowseLimit((n) => n + CATALOG_PAGE)}
                      className="app-button-secondary self-center"
                    >
                      {t("plugins.browse.showMore")}
                    </button>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </>
      ) : null}

      {tab === "marketplaces" ? (
        <>
          {cliBanner}
          {marketsError ? (
            <StatusBanner
              tone="danger"
              title={t("plugins.markets.loadFailed")}
              description={marketsError}
              actionLabel={t("common.retry")}
              onAction={() => void loadMarkets()}
            />
          ) : null}
          {cliReady ? (
            <>
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const source = newMarket.trim();
                  if (!source) return;
                  void ops
                    .run(
                      "markets:add",
                      t("plugins.markets.addLabel", { source }),
                      t("plugins.markets.added", { source }),
                      () => api.addMarketplace(source)
                    )
                    .then(() => setNewMarket(""));
                }}
              >
                <input
                  type="text"
                  value={newMarket}
                  onChange={(e) => setNewMarket(e.target.value)}
                  placeholder={t("plugins.markets.addPlaceholder")}
                  aria-label={t("plugins.markets.addPlaceholder")}
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={opBusy || newMarket.trim() === ""}
                  className="app-button-secondary shrink-0"
                >
                  {ops.busyKey === "markets:add" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {t("plugins.markets.add")}
                </button>
              </form>
              <p className="text-[12px] text-muted">{t("plugins.markets.addHint")}</p>

              {markets === null ? (
                <div className="flex items-center gap-2 text-[13px] text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("common.loading")}
                </div>
              ) : markets.length === 0 ? (
                <p className="text-[13px] text-muted">{t("plugins.markets.empty")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {markets.map((market) => (
                    <li
                      key={market.name}
                      className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-primary">{market.name}</p>
                        <p className="truncate text-[12px] text-muted">
                          {[market.kind, market.location].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {ops.busyKey === `market:${market.name}` ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted" />
                      ) : null}
                      <CardActionMenu
                        label={t("plugins.ops.menu", { name: market.name })}
                        actions={[
                          {
                            key: "update",
                            label: t("plugins.markets.update"),
                            icon: <RefreshCw className="h-3.5 w-3.5" />,
                            disabled: opBusy,
                            onSelect: () =>
                              void ops.run(
                                `market:${market.name}`,
                                t("plugins.markets.update"),
                                t("plugins.markets.updated", { name: market.name }),
                                () => api.updateMarketplaces(market.name)
                              ),
                          },
                          {
                            key: "remove",
                            label: t("plugins.markets.remove"),
                            icon: <Trash2 className="h-3.5 w-3.5" />,
                            danger: true,
                            disabled: opBusy,
                            onSelect: () => setConfirmRemoveMarket(market.name),
                          },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </>
      ) : null}

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

      <ConfirmDialog
        open={confirmUninstall !== null}
        tone="danger"
        title={t("plugins.ops.uninstallTitle", { name: confirmUninstall?.name ?? "" })}
        message={t("plugins.ops.uninstallMessage")}
        confirmLabel={t("plugins.ops.uninstall")}
        onClose={() => setConfirmUninstall(null)}
        onConfirm={async () => {
          const plugin = confirmUninstall;
          setConfirmUninstall(null);
          if (!plugin) return;
          await ops.run(
            `uninstall:${plugin.id}`,
            t("plugins.ops.uninstall"),
            t("plugins.ops.uninstalled", { name: plugin.name }),
            () => api.uninstallPlugin(plugin.id, plugin.scope)
          );
        }}
      />

      <ConfirmDialog
        open={confirmRemoveMarket !== null}
        tone="danger"
        title={t("plugins.markets.removeTitle", { name: confirmRemoveMarket ?? "" })}
        message={t("plugins.markets.removeMessage")}
        confirmLabel={t("plugins.markets.remove")}
        onClose={() => setConfirmRemoveMarket(null)}
        onConfirm={async () => {
          const name = confirmRemoveMarket;
          setConfirmRemoveMarket(null);
          if (!name) return;
          await ops.run(
            `market:${name}`,
            t("plugins.markets.remove"),
            t("plugins.markets.removed", { name }),
            () => api.removeMarketplace(name)
          );
        }}
      />

      {/* A marketplace wants to run its own command: show it, run it only on approval. */}
      <ConfirmDialog
        open={ops.pending !== null}
        tone="warning"
        title={t("plugins.ops.commandTitle")}
        message={t("plugins.ops.commandMessage", { action: ops.pending?.label ?? "" })}
        details={ops.pending ? [ops.pending.command.text] : undefined}
        confirmLabel={t("plugins.ops.commandRun")}
        onClose={ops.dismissPending}
        onConfirm={async () => {
          await ops.pending?.run();
        }}
      />
    </div>
  );
}
