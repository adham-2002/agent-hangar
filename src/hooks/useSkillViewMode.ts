import { useCallback, useEffect, useState } from "react";

export type SkillViewMode = "grid" | "list";

/**
 * My Skills view preferences, kept under one key so adding a preference does
 * not add a second storage entry to keep in sync.
 *
 * The stored value used to be the bare string `"grid"` / `"list"`; that form is
 * still read, so an existing installation keeps its view mode.
 */
interface ViewPreference {
  viewMode: SkillViewMode;
  groupBySource: boolean;
  /**
   * Whether `groupBySource` is the user's own choice. Until they use the toggle,
   * grouping follows the library (see `defaultGroupBySource`). This is a separate
   * flag because the preference has always been written back on load, so a
   * stored `groupBySource: false` cannot tell "turned off" from "never touched".
   */
  groupBySourceChosen: boolean;
}

const STORAGE_KEY = "skills-manager.skillViewMode";

const DEFAULT_PREFERENCE: ViewPreference = {
  viewMode: "grid",
  groupBySource: false,
  groupBySourceChosen: false,
};

export function readPreference(): ViewPreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "grid" || stored === "list") {
      return { ...DEFAULT_PREFERENCE, viewMode: stored };
    }
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ViewPreference>;
      return {
        viewMode: parsed.viewMode === "list" ? "list" : "grid",
        groupBySource: parsed.groupBySource === true,
        groupBySourceChosen: parsed.groupBySourceChosen === true,
      };
    }
  } catch {
    // Keep the view usable when browser storage is unavailable or holds junk.
  }
  return DEFAULT_PREFERENCE;
}

export function useSkillViewMode() {
  const [preference, setPreference] = useState<ViewPreference>(readPreference);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
    } catch {
      // The selection still works for the current page.
    }
  }, [preference]);

  const setViewMode = useCallback((next: SkillViewMode) => {
    setPreference((prev) => ({ ...prev, viewMode: next }));
  }, []);

  const setGroupBySource = useCallback((next: boolean) => {
    setPreference((prev) => ({ ...prev, groupBySource: next, groupBySourceChosen: true }));
  }, []);

  /** The user's grouping choice, or null when they have not made one yet. */
  const groupBySource = preference.groupBySourceChosen ? preference.groupBySource : null;

  return [preference.viewMode, setViewMode, groupBySource, setGroupBySource] as const;
}
