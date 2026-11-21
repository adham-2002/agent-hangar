import type { MemoryFile, MemoryProject } from "./tauri";
import type { SkillDraftSeed } from "../components/SkillEditorDialog";
import { toSkillName } from "./skillDraft";

/** A memory without its frontmatter. */
export function memoryBody(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "").trim();
}

/** The project's folder name, or Claude's folder name when the project is unknown. */
export function projectLabel(project: MemoryProject): string {
  const path = project.project_path;
  if (!path) return project.slug;
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Whether a memory (or, with `memory` null, the project itself) matches a search. */
export function memoryMatches(project: MemoryProject, memory: MemoryFile | null, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = [project.slug, project.project_path ?? ""];
  if (memory) fields.push(memory.file, memory.name ?? "", memory.description ?? "", memory.kind ?? "");
  return fields.some((f) => f.toLowerCase().includes(q));
}

/** A skill draft from a memory, for the skill editor to start from. */
export function memorySkillSeed(memory: MemoryFile, text: string): SkillDraftSeed {
  const base = memory.name ?? memory.file.replace(/\.md$/i, "");
  return {
    name: toSkillName(base),
    description: memory.description ?? "",
    body: memoryBody(text),
  };
}
