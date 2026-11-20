import { useEffect, useMemo, useState } from "react";

interface UseMultiSelectOptions<T> {
  items: T[];
  filtered: T[];
  getKey: (item: T) => string;
  isItemActive: (item: T) => boolean;
  /**
   * Serialized filter state (search text, tag/source filters, …). When it changes,
   * the selection is pruned to what is currently visible: bulk actions run over the
   * whole selection, so a selection carried across a filter change would silently
   * act on rows the user can no longer see.
   */
  filterSignal: string;
  /**
   * Identifies which list is on screen (a project id, an agent key, …). Changing
   * it clears the selection outright rather than pruning: the new list's data is
   * still loading, so there is nothing valid to prune against, and keys can
   * collide across scopes (project skills are keyed by relative path).
   */
  scopeSignal?: string;
  /** Set to false while a dialog is open, so Escape closes that first. */
  escapeEnabled?: boolean;
}

/**
 * A group's checkbox: if every key is selected, unselect them all; otherwise
 * add the missing ones. Keys outside the group are left as they are, so packs
 * can be combined.
 */
export function toggleKeys(prev: Set<string>, keys: string[]): Set<string> {
  const next = new Set(prev);
  if (keys.length > 0 && keys.every((key) => prev.has(key))) {
    for (const key of keys) next.delete(key);
  } else {
    for (const key of keys) next.add(key);
  }
  return next;
}

/** How much of a group is selected, for its checkbox. */
export function groupSelectionState(
  selected: Set<string>,
  keys: string[],
): "none" | "some" | "all" {
  const count = keys.filter((key) => selected.has(key)).length;
  if (count === 0) return "none";
  return count === keys.length ? "all" : "some";
}

export function useMultiSelect<T>({
  items,
  filtered,
  getKey,
  isItemActive,
  filterSignal,
  scopeSignal = "",
  escapeEnabled = true,
}: UseMultiSelectOptions<T>) {
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [rawSelectedIds, setRawSelectedIds] = useState(new Set<string>());

  // Adjust the selection during render when the list underneath it changes, rather
  // than in an effect (https://react.dev/learn/you-might-not-need-an-effect).
  const [prevScope, setPrevScope] = useState(scopeSignal);
  const [prevFilter, setPrevFilter] = useState(filterSignal);
  let selectionAdjusted = false;
  if (prevScope !== scopeSignal) {
    setPrevScope(scopeSignal);
    setPrevFilter(filterSignal);
    if (rawSelectedIds.size > 0) setRawSelectedIds(new Set<string>());
    selectionAdjusted = true;
  } else if (prevFilter !== filterSignal) {
    setPrevFilter(filterSignal);
    if (rawSelectedIds.size > 0) {
      const visible = new Set(filtered.map(getKey));
      const pruned = new Set([...rawSelectedIds].filter((key) => visible.has(key)));
      if (pruned.size !== rawSelectedIds.size) setRawSelectedIds(pruned);
    }
    selectionAdjusted = true;
  }

  /**
   * Keys whose item is gone (deleted here or elsewhere) are dropped, so the toolbar
   * never counts rows the handlers would skip. Derived from `items` rather than
   * `filtered`: a selection merely hidden by a filter stays intact.
   */
  const selectedIds = useMemo(() => {
    if (rawSelectedIds.size === 0) return rawSelectedIds;
    const existing = new Set(items.map(getKey));
    const live = new Set([...rawSelectedIds].filter((key) => existing.has(key)));
    return live.size === rawSelectedIds.size ? rawSelectedIds : live;
    // getKey is redeclared inline by most callers; items and the raw set drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, rawSelectedIds]);

  // Commit that pruning, so a key does not linger and re-select a later item that
  // happens to reuse it (project rows are keyed by relative path). Skipped on the
  // render that already adjusted the selection above, which would otherwise undo it.
  if (!selectionAdjusted && selectedIds !== rawSelectedIds) {
    setRawSelectedIds(selectedIds);
  }

  const toggleSelect = (key: string) => {
    setRawSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Select every key in `keys`, or clear them all when every one is already selected. */
  const toggleSelectMany = (keys: string[]) => {
    setRawSelectedIds((prev) => toggleKeys(prev, keys));
  };

  /** Replace the selection with exactly `keys`. */
  const selectOnly = (keys: string[]) => {
    setRawSelectedIds(new Set(keys));
  };

  const isAllSelected =
    filtered.length > 0 && filtered.every((s) => selectedIds.has(getKey(s)));

  const anyDisabled = items
    .filter((s) => selectedIds.has(getKey(s)))
    .some((s) => !isItemActive(s));

  const handleSelectAll = () => {
    setRawSelectedIds(
      isAllSelected ? new Set<string>() : new Set(filtered.map(getKey))
    );
  };

  const exitMultiSelect = () => {
    setIsMultiSelect(false);
    setRawSelectedIds(new Set<string>());
  };

  // Escape leaves selection mode, unless a dialog is open and owns the key.
  useEffect(() => {
    if (!isMultiSelect || !escapeEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      setIsMultiSelect(false);
      setRawSelectedIds(new Set<string>());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMultiSelect, escapeEnabled]);

  return {
    isMultiSelect,
    setIsMultiSelect,
    selectedIds,
    toggleSelect,
    toggleSelectMany,
    selectOnly,
    isAllSelected,
    anyDisabled,
    handleSelectAll,
    exitMultiSelect,
  };
}
