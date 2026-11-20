import type { ManagedSkill } from "./tauri";

/** How much of a pack is deployed to one agent. */
export type PackAgentState = "all" | "some" | "none";

const isDeployed = (skill: ManagedSkill, toolKey: string) =>
  skill.targets.some((target) => target.tool === toolKey);

export function packAgentState(skills: ManagedSkill[], toolKey: string): PackAgentState {
  const deployed = skills.filter((skill) => isDeployed(skill, toolKey)).length;
  if (deployed === 0) return "none";
  return deployed === skills.length ? "all" : "some";
}

/**
 * What one click on a pack's agent does. A fully deployed pack is removed from
 * the agent; a partly or not deployed one is completed, so the first click on a
 * partial pack never takes skills away. Returns the next state and exactly the
 * skills that need a call, so skills already in that state are not touched.
 */
export function packToggle(
  skills: ManagedSkill[],
  toolKey: string,
): { enable: boolean; skills: ManagedSkill[] } {
  const enable = packAgentState(skills, toolKey) !== "all";
  return {
    enable,
    skills: skills.filter((skill) => isDeployed(skill, toolKey) !== enable),
  };
}
