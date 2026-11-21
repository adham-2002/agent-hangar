import type {
  ContextCost,
  ManagedSkill,
  PluginDetail,
  PluginInfo,
  SkillUsage,
  ToolInfo,
  UsageReport,
} from "./tauri";
import { getSkillSourceInfo } from "./skillSource";

export const DAY_SECONDS = 24 * 3600;
/** "Unused" means no use within this many days. */
export const UNUSED_DAYS = 30;
const CLAUDE_CODE = "claude_code";

/** Successful uses of one skill or plugin, folded from the usage report. */
export interface Usage {
  uses: number;
  last30Days: number;
  /** Unix seconds. */
  lastUsed: number | null;
  projects: string[];
}

const emptyUsage = (): Usage => ({ uses: 0, last30Days: 0, lastUsed: null, projects: [] });

function fold(into: Usage, row: SkillUsage) {
  into.uses += row.invoked + row.typed;
  into.last30Days += row.last_30_days;
  if (row.last_used !== null) into.lastUsed = Math.max(into.lastUsed ?? 0, row.last_used);
  for (const p of row.projects) if (!into.projects.includes(p)) into.projects.push(p);
}

/**
 * Attribute transcript names to library skills and plugins. A plugin's skill
 * appears as `plugin:skill`; a bare name (`/seo`, or Claude invoking `seo`)
 * belongs to the library skill of that name when there is one, otherwise to
 * the plugin that bundles a skill of that name. Names that match neither are
 * Claude's own commands (`/model`, `/clear`) and are dropped.
 */
export function attributeUsage(
  report: UsageReport | null,
  skills: ManagedSkill[],
  plugins: PluginInfo[],
  details: Record<string, PluginDetail>,
): { bySkill: Map<string, Usage>; byPlugin: Map<string, Usage> } {
  const bySkill = new Map<string, Usage>();
  const byPlugin = new Map<string, Usage>();
  if (!report) return { bySkill, byPlugin };

  const skillByName = new Map(skills.map((s) => [s.name.toLowerCase(), s.id]));
  const pluginByName = new Map(plugins.map((p) => [p.name.toLowerCase(), p.id]));
  const pluginBySkill = new Map<string, string>();
  for (const p of plugins) {
    for (const s of details[p.id]?.skills ?? []) {
      if (!pluginBySkill.has(s.toLowerCase())) pluginBySkill.set(s.toLowerCase(), p.id);
    }
  }
  const add = (map: Map<string, Usage>, key: string, row: SkillUsage) => {
    const usage = map.get(key) ?? emptyUsage();
    fold(usage, row);
    map.set(key, usage);
  };

  for (const row of report.skills) {
    const name = row.name.toLowerCase();
    const colon = name.indexOf(":");
    if (colon > 0) {
      const pluginId = pluginByName.get(name.slice(0, colon));
      if (pluginId) add(byPlugin, pluginId, row);
      continue;
    }
    const skillId = skillByName.get(name);
    if (skillId) {
      add(bySkill, skillId, row);
      continue;
    }
    const pluginId = pluginBySkill.get(name) ?? pluginByName.get(name);
    if (pluginId) add(byPlugin, pluginId, row);
  }
  return { bySkill, byPlugin };
}

/** One thing an agent loads into every session. */
export interface BudgetItem {
  kind: "skill" | "plugin";
  id: string;
  name: string;
  /** Matches the source colour map, so a pack keeps its colour here. */
  colorKey: string;
  alwaysOn: number;
  onInvoke: number;
  /** Whether `alwaysOn` is Claude's own figure rather than an estimate. */
  exact: boolean;
  usage: Usage | null;
}

export interface AgentBudget {
  tool: ToolInfo;
  total: number;
  items: BudgetItem[];
  /** Usage is only known for Claude Code, whose transcripts it reads. */
  tracksUsage: boolean;
}

/**
 * What each agent loads into every session: library skills deployed to it,
 * plus, for Claude Code, its enabled plugins. Heaviest first; agents with
 * nothing loaded are left out.
 */
export function agentBudgets(input: {
  skills: ManagedSkill[];
  tools: ToolInfo[];
  plugins: PluginInfo[];
  skillCosts: Map<string, ContextCost>;
  pluginCosts: Map<string, { cost: ContextCost; exact: boolean }>;
  pluginColorKeys: Map<string, string>;
  usage: { bySkill: Map<string, Usage>; byPlugin: Map<string, Usage> };
}): AgentBudget[] {
  const out: AgentBudget[] = [];
  for (const tool of input.tools.filter((t) => t.installed && t.enabled)) {
    const isClaude = tool.key === CLAUDE_CODE;
    const items: BudgetItem[] = [];
    for (const skill of input.skills) {
      if (!skill.targets.some((t) => t.tool === tool.key)) continue;
      const cost = input.skillCosts.get(skill.id) ?? { always_on: 0, on_invoke: 0 };
      items.push({
        kind: "skill",
        id: skill.id,
        name: skill.name,
        colorKey: getSkillSourceInfo(skill).key,
        alwaysOn: cost.always_on,
        onInvoke: cost.on_invoke,
        exact: false,
        usage: isClaude ? (input.usage.bySkill.get(skill.id) ?? emptyUsage()) : null,
      });
    }
    if (isClaude) {
      for (const plugin of input.plugins.filter((p) => p.installed && p.enabled)) {
        const entry = input.pluginCosts.get(plugin.id);
        if (!entry) continue;
        items.push({
          kind: "plugin",
          id: plugin.id,
          name: plugin.name,
          colorKey: input.pluginColorKeys.get(plugin.id) ?? `plugin:${plugin.id}`,
          alwaysOn: entry.cost.always_on,
          onInvoke: entry.cost.on_invoke,
          exact: entry.exact,
          usage: input.usage.byPlugin.get(plugin.id) ?? emptyUsage(),
        });
      }
    }
    if (items.length === 0) continue;
    items.sort((a, b) => b.alwaysOn - a.alwaysOn || a.name.localeCompare(b.name));
    out.push({ tool, items, total: items.reduce((n, i) => n + i.alwaysOn, 0), tracksUsage: isClaude });
  }
  return out.sort((a, b) => b.total - a.total);
}

/**
 * Claude Code items not used in the last 30 days that still cost context.
 * A skill added to the library in the last 30 days has not had the chance to
 * be used, and is left out; so are all items when the transcripts cover less
 * than 30 days, because silence then proves nothing.
 */
export function unusedItems(
  budget: AgentBudget | undefined,
  report: UsageReport | null,
  skills: ManagedSkill[],
  nowSeconds: number,
): BudgetItem[] {
  if (!budget?.tracksUsage || !report?.since) return [];
  const window = UNUSED_DAYS * DAY_SECONDS;
  if (nowSeconds - report.since < window) return [];
  const created = new Map(skills.map((s) => [s.id, s.created_at / 1000]));
  return budget.items.filter((item) => {
    if ((item.usage?.last30Days ?? 0) > 0 || item.alwaysOn === 0) return false;
    if (item.kind === "skill" && nowSeconds - (created.get(item.id) ?? 0) < window) return false;
    return true;
  });
}

/** Uses needed before "only ever used in one project" means anything. */
export const PROJECT_ONLY_MIN_USES = 3;

/** A path folded for comparison: forward slashes, no trailing slash, and
 *  lowercase on Windows, whose paths are case-insensitive. */
export function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(slashed) || slashed.startsWith("//") ? slashed.toLowerCase() : slashed;
}

function isInside(path: string, root: string) {
  return path === root || path.startsWith(`${root}/`);
}

/** A skill Claude Code loads everywhere but has only used in one project. */
export interface ProjectOnlyCandidate {
  item: BudgetItem;
  /** The folder to move it into, as the transcripts or the project list spell it. */
  projectPath: string;
  /** The registered project, when the folder already is one. */
  projectId: string | null;
}

/**
 * Global Claude Code skills that have only ever been used inside one project,
 * often enough to tell. Moving such a skill into that project keeps it where
 * it is used and takes it out of every other session. A session started in a
 * subfolder of a registered project counts as that project. Sessions in the
 * home folder are not a project, so a skill used there is left alone.
 */
export function projectOnlyCandidates(
  budget: AgentBudget | undefined,
  report: UsageReport | null,
  projects: { id: string; path: string }[],
  homeDir: string | null,
  nowSeconds: number,
): ProjectOnlyCandidate[] {
  if (!budget?.tracksUsage || !report?.since) return [];
  if (nowSeconds - report.since < UNUSED_DAYS * DAY_SECONDS) return [];
  const roots = projects
    .map((p) => ({ id: p.id, path: p.path, norm: normalizePath(p.path) }))
    .sort((a, b) => b.norm.length - a.norm.length);
  const home = homeDir ? normalizePath(homeDir) : null;

  const out: ProjectOnlyCandidate[] = [];
  for (const item of budget.items) {
    const usage = item.usage;
    if (item.kind !== "skill" || !usage || usage.uses < PROJECT_ONLY_MIN_USES || usage.projects.length === 0) {
      continue;
    }
    const folders = new Map<string, { path: string; id: string | null }>();
    for (const cwd of usage.projects) {
      const norm = normalizePath(cwd);
      const root = roots.find((r) => isInside(norm, r.norm));
      const key = root?.norm ?? norm;
      folders.set(key, root ? { path: root.path, id: root.id } : { path: cwd, id: null });
    }
    if (folders.size !== 1) continue;
    const [[key, folder]] = [...folders];
    // The home folder, or a folder above it, holds everything: not a project.
    if (home !== null && isInside(home, key)) continue;
    out.push({ item, projectPath: folder.path, projectId: folder.id });
  }
  return out.sort((a, b) => b.item.alwaysOn - a.item.alwaysOn);
}

/** Most used Claude Code items, busiest first. */
export function mostUsed(budget: AgentBudget | undefined, limit = 10): BudgetItem[] {
  return (budget?.items ?? [])
    .filter((i) => (i.usage?.uses ?? 0) > 0)
    .sort((a, b) => (b.usage!.last30Days - a.usage!.last30Days) || (b.usage!.uses - a.usage!.uses))
    .slice(0, limit);
}

/** `4.8k`, `850`. */
export function formatTokens(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
