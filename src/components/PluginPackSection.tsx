import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PluginInfo } from "../lib/tauri";
import type { PluginPack } from "../lib/pluginPacks";
import type { SourceColorClass } from "../lib/sourceColor";
import { CardActionMenu } from "./CardActionMenu";
import { ToggleSwitch } from "./ToggleSwitch";
import { PluginSkillSheet, type PluginSkillTarget } from "./PluginSkillSheet";
import { cn } from "../utils";

interface Props {
  packs: PluginPack[];
  colors: Map<string, SourceColorClass>;
  /** Plugin ids Claude Code also loads as library skills. */
  duplicateIds: Set<string>;
  pending: Set<string>;
  onToggle: (plugin: PluginInfo) => void;
  onOpenPlugins: () => void;
  /** Card grid: each pack is a panel holding its skills as cards. */
  grid?: boolean;
}

/** How many skill names a collapsed pack previews in the grid. */
const PREVIEW = 3;

/**
 * Claude Code plugins listed as packs in Library, below the library's own
 * sources and in the same header style. Their skills are read-only here:
 * Claude Code owns them, so the only control is the plugin's on/off switch.
 */
export function PluginPackSection({
  packs,
  colors,
  duplicateIds,
  pending,
  onToggle,
  onOpenPlugins,
  grid = false,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openSkill, setOpenSkill] = useState<PluginSkillTarget | null>(null);
  if (packs.length === 0) return null;

  return (
    <section className="pb-8" aria-label={t("mySkills.pluginPacks.title")}>
      <h2 className="app-section-title mb-1">{t("mySkills.pluginPacks.title")}</h2>
      <p className="mb-2 text-[12px] text-muted">{t("mySkills.pluginPacks.hint")}</p>
      <ul className={cn("flex flex-col", grid && "gap-3")}>
        {packs.map(({ plugin, detail, colorKey }) => {
          const expanded = open[plugin.id] ?? false;
          const skills = detail?.skills ?? [];
          const color = colors.get(colorKey) ?? null;
          return (
            <li
              key={plugin.id}
              className={
                grid
                  ? "rounded-xl border border-border-subtle bg-surface-hover/30 p-2.5"
                  : "border-b border-border-subtle"
              }
            >
              <div className={cn("flex items-center gap-1 text-muted", grid ? "pb-0.5" : "pt-3 pb-1")}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen((prev) => ({ ...prev, [plugin.id]: !expanded }))}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left font-semibold transition-colors hover:bg-surface-hover hover:text-secondary"
                >
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", color ?? "bg-surface-active")} />
                  <span className="truncate text-[13px] text-secondary">{plugin.name}</span>
                  <span className="shrink-0 text-[11px] font-medium text-faint">{skills.length}</span>
                  <span className="shrink-0 rounded-full border border-border-subtle px-2 py-0.5 text-[11px] font-medium text-muted">
                    {t("mySkills.pluginPacks.badge")}
                  </span>
                  {duplicateIds.has(plugin.id) ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" />
                      {t("mySkills.pluginPacks.alsoInLibrary")}
                    </span>
                  ) : null}
                  {plugin.update_available ? (
                    <span
                      title={t("plugins.updates.hint")}
                      className="shrink-0 rounded-full border border-accent/30 bg-accent-bg px-2 py-0.5 text-[11px] font-medium text-accent"
                    >
                      {t("plugins.updates.badge")}
                    </span>
                  ) : null}
                  {!plugin.files_present ? (
                    <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                      {t("plugins.filesMissing")}
                    </span>
                  ) : null}
                </button>
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
                    onChange={() => onToggle(plugin)}
                    loading={pending.has(plugin.id)}
                    disabled={pending.has(plugin.id)}
                    title={t("mySkills.pluginPacks.toggle", { name: plugin.name })}
                  />
                )}
                <CardActionMenu
                  label={t("mySkills.sourceGroup.actions", { source: plugin.name })}
                  actions={[
                    {
                      key: "open",
                      label: t("mySkills.pluginPacks.openInPlugins"),
                      icon: <ExternalLink className="h-3.5 w-3.5" />,
                      onSelect: onOpenPlugins,
                    },
                  ]}
                />
              </div>
              {grid && !expanded && skills.length > 0 ? (
                <p className="truncate px-1 pl-6 text-[12px] text-muted">
                  {skills.slice(0, PREVIEW).join(", ")}
                  {skills.length > PREVIEW
                    ? ` ${t("mySkills.pluginPacks.more", { count: skills.length - PREVIEW })}`
                    : ""}
                </p>
              ) : null}
              {expanded ? (
                <div className={grid ? "mt-2" : "px-1 pb-3"}>
                  {skills.length > 0 && grid ? (
                    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                      {skills.map((name) => (
                        <li key={name}>
                          <button
                            type="button"
                            disabled={!plugin.install_path}
                            onClick={() => {
                              if (plugin.install_path) {
                                setOpenSkill({ installPath: plugin.install_path, skill: name, pluginName: plugin.name });
                              }
                            }}
                            className="app-panel relative flex h-full w-full items-center gap-2 px-3 py-2.5 text-left shadow-card transition-all hover:-translate-y-px hover:border-border hover:shadow-card-hover disabled:cursor-default disabled:hover:translate-y-0"
                          >
                            <span
                              aria-hidden
                              className={cn("absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full", color ?? "bg-surface-active")}
                            />
                            <span className="min-w-0 truncate text-[13px] font-medium text-primary">{name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : skills.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {skills.map((name) => (
                        <li key={name}>
                          <button
                            type="button"
                            disabled={!plugin.install_path}
                            onClick={() => {
                              if (plugin.install_path) {
                                setOpenSkill({ installPath: plugin.install_path, skill: name, pluginName: plugin.name });
                              }
                            }}
                            className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[12px] text-secondary transition-colors hover:border-border hover:bg-surface-hover hover:text-primary"
                          >
                            {name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-muted">{t("mySkills.pluginPacks.noSkills")}</p>
                  )}
                  <p className={cn("text-[12px] text-muted", grid ? "mt-2 px-1" : "mt-2")}>
                    {t("mySkills.pluginPacks.managedByClaude")}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <PluginSkillSheet target={openSkill} onClose={() => setOpenSkill(null)} />
    </section>
  );
}
