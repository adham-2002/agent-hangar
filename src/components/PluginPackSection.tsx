import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PluginInfo } from "../lib/tauri";
import type { PluginPack } from "../lib/pluginPacks";
import type { SourceColorClass } from "../lib/sourceColor";
import { CardActionMenu } from "./CardActionMenu";
import { ToggleSwitch } from "./ToggleSwitch";
import { cn } from "../utils";

interface Props {
  packs: PluginPack[];
  colors: Map<string, SourceColorClass>;
  /** Plugin ids Claude Code also loads as library skills. */
  duplicateIds: Set<string>;
  pending: Set<string>;
  onToggle: (plugin: PluginInfo) => void;
  onOpenPlugins: () => void;
}

/**
 * Claude Code plugins listed as packs in Library, below the library's own
 * sources and in the same header style. Their skills are read-only here:
 * Claude Code owns them, so the only control is the plugin's on/off switch.
 */
export function PluginPackSection({ packs, colors, duplicateIds, pending, onToggle, onOpenPlugins }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (packs.length === 0) return null;

  return (
    <section className="pb-8" aria-label={t("mySkills.pluginPacks.title")}>
      <h2 className="app-section-title mb-1">{t("mySkills.pluginPacks.title")}</h2>
      <p className="mb-2 text-[12px] text-muted">{t("mySkills.pluginPacks.hint")}</p>
      <ul className="flex flex-col">
        {packs.map(({ plugin, detail, colorKey }) => {
          const expanded = open[plugin.id] ?? false;
          const skills = detail?.skills ?? [];
          const color = colors.get(colorKey) ?? null;
          return (
            <li key={plugin.id} className="border-b border-border-subtle">
              <div className="flex items-center gap-1 pt-3 pb-1 text-muted">
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
                  {!plugin.files_present ? (
                    <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                      {t("plugins.filesMissing")}
                    </span>
                  ) : null}
                </button>
                <ToggleSwitch
                  checked={plugin.enabled}
                  onChange={() => onToggle(plugin)}
                  loading={pending.has(plugin.id)}
                  disabled={pending.has(plugin.id)}
                  title={t("mySkills.pluginPacks.toggle", { name: plugin.name })}
                />
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
              {expanded ? (
                <div className="px-1 pb-3">
                  {skills.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {skills.map((name) => (
                        <li
                          key={name}
                          className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[12px] text-secondary"
                        >
                          {name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-muted">{t("mySkills.pluginPacks.noSkills")}</p>
                  )}
                  <p className="mt-2 text-[12px] text-muted">{t("mySkills.pluginPacks.managedByClaude")}</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
