import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DuplicatePack } from "../lib/pluginPacks";

interface Props {
  duplicate: DuplicatePack;
  busy: boolean;
  onDisablePlugin: () => void;
  onRemoveLibraryCopies: () => void;
}

/**
 * A pack Claude Code loads twice. It names both copies and offers both fixes,
 * because which one to keep is the user's call: the plugin also brings
 * commands, hooks and MCP servers, the library copy can go to other agents.
 */
export function DuplicatePackBanner({ duplicate, busy, onDisablePlugin, onRemoveLibraryCopies }: Props) {
  const { t } = useTranslation();
  const source = duplicate.groupLabel ?? duplicate.plugin.name;
  const names = duplicate.skills.map((s) => s.name);
  const shown = names.slice(0, 4).join(", ") + (names.length > 4 ? ", …" : "");

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-primary">
          {t("mySkills.duplicatePack.title", { source, plugin: duplicate.plugin.name })}
        </p>
        <p className="text-[12px] text-muted">
          {t("mySkills.duplicatePack.description", { count: names.length, names: shown })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : null}
        <button
          type="button"
          disabled={busy}
          onClick={onDisablePlugin}
          className="rounded-lg border border-border-subtle bg-surface px-2.5 py-1 text-[12px] font-medium text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          {t("mySkills.duplicatePack.disablePlugin")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onRemoveLibraryCopies}
          className="rounded-lg border border-border-subtle bg-surface px-2.5 py-1 text-[12px] font-medium text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          {t("mySkills.duplicatePack.removeLibrary", { count: names.length })}
        </button>
      </div>
    </div>
  );
}
