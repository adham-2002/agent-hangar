import type { ManagedSkill } from "./tauri";

export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;

/** The Agent Skills name format; the backend holds new skills to it. */
export function isSpecName(name: string) {
  return name.length > 0 && name.length <= SKILL_NAME_MAX && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

/** What a typed name becomes: lowercase, spaces and underscores as hyphens. */
export function toSkillName(input: string) {
  return input.toLowerCase().replace(/[\s_]+/g, "-");
}

/** The SKILL.md a new skill's fields make, for checking and preview. JSON
 *  strings are valid YAML, so quotes and colons stay inside the value. */
export function draftSkillMd(name: string, description: string, body: string) {
  const head = `---\nname: ${JSON.stringify(name.trim())}\ndescription: ${JSON.stringify(description.trim())}\n---\n`;
  return body.trim() ? `${head}\n${body.replace(/^\n+/, "")}` : head;
}

/** Whether updating the skill from where it came from would overwrite edits. */
export function hasUpdateSource(skill: ManagedSkill) {
  const local = skill.source_type === "local" || skill.source_type === "import";
  return !local || Boolean(skill.source_ref);
}
