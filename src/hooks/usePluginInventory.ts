import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as api from "../lib/tauri";
import type { PluginDetail, PluginInfo } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";

/**
 * Claude Code's installed plugins with what each bundles, and an on/off toggle.
 * Shared by the Plugins page and Library so both read the same state and turn
 * a plugin off the same way. Reloads on window focus, because the claude CLI
 * changes plugins behind the app's back.
 */
export function usePluginInventory() {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [details, setDetails] = useState<Record<string, PluginDetail>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const loadSeq = useRef(0);
  // `load` must not change identity when the language does, or it would refetch.
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const list = await api.listPlugins();
      if (seq !== loadSeq.current) return;
      setPlugins(list);
      setLoadError(null);
      const entries = await Promise.all(
        list
          .filter((p) => p.installed && p.files_present && p.install_path)
          .map(async (p) => {
            try {
              return [p.id, await api.getPluginDetail(p.install_path as string)] as const;
            } catch {
              return null;
            }
          }),
      );
      if (seq !== loadSeq.current) return;
      setDetails(Object.fromEntries(entries.filter((e) => e !== null)));
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setLoadError(getErrorMessage(e, tRef.current("common.error")));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  /** Set a plugin on or off; the switch flips at once and reverts on failure. */
  const setEnabled = useCallback(async (plugin: PluginInfo, next: boolean) => {
    setPending((s) => new Set(s).add(plugin.id));
    setPlugins((list) => list.map((p) => (p.id === plugin.id ? { ...p, enabled: next } : p)));
    try {
      await api.setPluginEnabled(plugin.id, next);
      return true;
    } catch (e) {
      setPlugins((list) =>
        list.map((p) => (p.id === plugin.id ? { ...p, enabled: plugin.enabled } : p)),
      );
      toast.error(getErrorMessage(e, tRef.current("plugins.toggleFailed")));
      return false;
    } finally {
      setPending((s) => {
        const copy = new Set(s);
        copy.delete(plugin.id);
        return copy;
      });
    }
  }, []);

  return { plugins, details, loading, loadError, pending, reload: load, setEnabled };
}
