import type { ManagedSkill, PluginDetail, PluginInfo } from "./tauri";
import { gitSourceKey, type SkillSourceGroup } from "./skillSource";

/** Claude Code is the only agent that has plugins. */
export const CLAUDE_CODE_KEY = "claude_code";

/** An installed Claude Code plugin, seen as a pack next to the library's sources. */
export interface PluginPack {
  plugin: PluginInfo;
  detail: PluginDetail | undefined;
  /** Shared with a library source when both come from the same repo, so they share a colour. */
  colorKey: string;
  /** The library grouping key of the plugin's source repo, when known. */
  repoKey: string | null;
}

export function pluginPacks(
  plugins: PluginInfo[],
  details: Record<string, PluginDetail>,
): PluginPack[] {
  return plugins
    .filter((plugin) => plugin.installed)
    .map((plugin) => {
      const repoKey = plugin.source_repo ? gitSourceKey(plugin.source_repo) : null;
      return {
        plugin,
        detail: details[plugin.id],
        repoKey,
        colorKey: repoKey ?? `plugin:${plugin.id}`,
      };
    });
}

/** One pack Claude Code loads twice: as an enabled plugin and as library skills. */
export interface DuplicatePack {
  plugin: PluginInfo;
  groupKey: string;
  groupLabel: string | null;
  /** The library skills Claude Code also gets from the plugin. */
  skills: ManagedSkill[];
}

const folderName = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "";

/**
 * Packs installed twice for Claude Code. Both sides have to be live for the
 * duplicate to be real: the plugin enabled, and the library skill deployed to
 * Claude Code. Same repo alone is not enough; a skill only counts when the
 * plugin bundles a skill of the same name, so a repo that ships different
 * skills through each channel is not flagged.
 */
export function findDuplicatePacks(
  groups: SkillSourceGroup[],
  packs: PluginPack[],
): DuplicatePack[] {
  const out: DuplicatePack[] = [];
  for (const pack of packs) {
    if (!pack.plugin.enabled || !pack.repoKey || !pack.detail) continue;
    const group = groups.find((g) => g.key === pack.repoKey);
    if (!group) continue;
    const names = new Set(pack.detail.skills.map((name) => name.toLowerCase()));
    const skills = group.skills.filter(
      (skill) =>
        skill.targets.some((target) => target.tool === CLAUDE_CODE_KEY) &&
        (names.has(skill.name.toLowerCase()) || names.has(folderName(skill.central_path).toLowerCase())),
    );
    if (skills.length > 0) {
      out.push({ plugin: pack.plugin, groupKey: group.key, groupLabel: group.label, skills });
    }
  }
  return out;
}
