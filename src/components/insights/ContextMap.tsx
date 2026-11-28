import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../utils";
import { formatTokens, type AgentBudget, type BudgetItem } from "../../lib/insights";
import { treemap } from "../../lib/treemap";
import { AgentIcon } from "../AgentIcon";

const MAP_HEIGHT = 320;

interface Block {
  key: string;
  label: string;
  tokens: number;
  items: BudgetItem[];
  unused: number;
  problems: number;
}

interface Props {
  budgets: AgentBudget[];
  colorMap: Map<string, string>;
  packLabels: Map<string, string>;
  unusedIds: Set<string>;
  problemIds: Set<string>;
  /** Takes one skill or plugin out of the agent; the page confirms first. */
  onRemove: (item: BudgetItem, agentKey: string) => void;
}

/**
 * What one agent loads into every session, as a treemap: each pack is a block
 * sized by its tokens. Unused packs are faded and packs with problems carry a
 * warning, so the heavy and the idle stand out without reading a table.
 */
export function ContextMap({ budgets, colorMap, packLabels, unusedIds, problemIds, onRemove }: Props) {
  const { t } = useTranslation();
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [width, setWidth] = useState(800);
  const box = useRef<HTMLDivElement>(null);

  const budget = budgets.find((b) => b.tool.key === agentKey) ?? budgets[0];

  useEffect(() => {
    const el = box.current;
    // The observer reports the first size as soon as it starts watching.
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || 800));
    observer.observe(el);
    return () => observer.disconnect();
  }, [budget?.tool.key]);

  const blocks = useMemo<Block[]>(() => {
    if (!budget) return [];
    const byKey = new Map<string, Block>();
    for (const item of budget.items) {
      if (item.alwaysOn <= 0) continue;
      const key = item.colorKey;
      const block = byKey.get(key) ?? {
        key,
        label: item.kind === "plugin" ? item.name : (packLabels.get(key) ?? item.name),
        tokens: 0,
        items: [],
        unused: 0,
        problems: 0,
      };
      block.tokens += item.alwaysOn;
      block.items.push(item);
      if (unusedIds.has(item.id)) block.unused += 1;
      if (problemIds.has(item.id)) block.problems += 1;
      byKey.set(key, block);
    }
    for (const b of byKey.values()) {
      // A pack of one is named after its skill.
      if (b.items.length === 1) b.label = b.items[0].name;
      b.items.sort((x, y) => y.alwaysOn - x.alwaysOn);
    }
    return [...byKey.values()];
  }, [budget, packLabels, unusedIds, problemIds]);

  const rects = useMemo(() => treemap(blocks, (b) => b.tokens, width, MAP_HEIGHT), [blocks, width]);
  const active = blocks.find((b) => b.key === selected) ?? null;

  if (!budget) return <p className="text-[13px] text-muted">{t("insights.budget.empty")}</p>;

  return (
    <section aria-label={t("insights.map.title")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {budgets.map((b) => (
          <button
            key={b.tool.key}
            type="button"
            onClick={() => {
              setAgentKey(b.tool.key);
              setSelected(null);
            }}
            aria-pressed={b.tool.key === budget.tool.key}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] outline-none transition-colors",
              b.tool.key === budget.tool.key
                ? "border-accent bg-accent-bg text-primary"
                : "border-border-subtle text-secondary hover:bg-surface-hover",
            )}
          >
            <AgentIcon agentKey={b.tool.key} className="h-3.5 w-3.5" />
            {b.tool.display_name}
            <span className="tabular-nums text-muted">{formatTokens(b.total)}</span>
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted">
        {t("insights.map.hint", { agent: budget.tool.display_name, tokens: formatTokens(budget.total) })}
      </p>

      <div ref={box} className="relative w-full overflow-hidden rounded-xl border border-border-subtle" style={{ height: MAP_HEIGHT }}>
        {rects.map(({ item: block, x, y, w, h }) => {
          const allUnused = block.unused === block.items.length;
          const roomy = w > 70 && h > 34;
          return (
            <button
              key={block.key}
              type="button"
              onClick={() => setSelected(block.key === selected ? null : block.key)}
              title={`${block.label} · ${formatTokens(block.tokens)}`}
              aria-label={`${block.label} · ${formatTokens(block.tokens)}`}
              aria-pressed={block.key === selected}
              className={cn(
                "absolute overflow-hidden border border-surface p-1.5 text-left text-white outline-none transition-opacity",
                colorMap.get(block.key) ?? "bg-surface-active",
                allUnused ? "opacity-35" : block.unused > 0 ? "opacity-75" : "opacity-95",
                block.key === selected ? "z-10 ring-2 ring-inset ring-white" : "hover:opacity-100",
              )}
              style={{ left: x, top: y, width: w, height: h }}
            >
              {roomy ? (
                <span className="flex flex-col gap-0.5 drop-shadow">
                  <span className="flex items-center gap-1 truncate text-[12px] font-semibold">
                    {block.problems > 0 ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
                    <span className="truncate">{block.label}</span>
                  </span>
                  <span className="text-[11px] tabular-nums">{formatTokens(block.tokens)}</span>
                  {block.unused > 0 && h > 54 ? (
                    <span className="text-[11px]">{t("insights.map.unusedCount", { count: block.unused })}</span>
                  ) : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">{t("insights.map.legend")}</p>

      {active ? (
        <div className="rounded-xl border border-border-subtle bg-surface p-3">
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", colorMap.get(active.key) ?? "bg-surface-active")} />
            <span className="truncate text-[13px] font-semibold text-primary">{active.label}</span>
            <span className="ml-auto text-[12px] text-secondary">
              {t("insights.budget.total", { tokens: formatTokens(active.tokens) })}
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-border-faint">
            {active.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="min-w-0 truncate text-primary">{item.name}</span>
                {unusedIds.has(item.id) ? (
                  <span className="shrink-0 rounded-full bg-surface-hover px-1.5 text-[11px] text-muted">
                    {t("insights.map.unused")}
                  </span>
                ) : null}
                {problemIds.has(item.id) ? (
                  <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 text-[11px] text-red-600 dark:text-red-300">
                    {t("insights.map.problem")}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted">{formatTokens(item.alwaysOn)}</span>
                <button
                  type="button"
                  onClick={() => onRemove(item, budget.tool.key)}
                  className="app-button-secondary shrink-0"
                >
                  {item.kind === "plugin"
                    ? t("insights.map.turnOff")
                    : t("insights.map.remove", { agent: budget.tool.display_name })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[12px] text-muted">{t("insights.map.pick")}</p>
      )}
    </section>
  );
}
