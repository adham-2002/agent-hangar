import { describe, expect, it } from "vitest";
import { memoryBody, memoryMatches, memorySkillSeed, projectLabel } from "./memory";
import type { MemoryFile, MemoryProject } from "./tauri";

const memory = (over: Partial<MemoryFile> = {}): MemoryFile => ({
  file: "deploy_pipeline.md",
  path: "/c/projects/x/memory/deploy_pipeline.md",
  name: "deploy-pipeline",
  description: "How the site is deployed",
  kind: "project",
  bytes: 100,
  tokens: 30,
  modified: null,
  in_index: true,
  findings: [],
  ...over,
});

const project = (over: Partial<MemoryProject> = {}): MemoryProject => ({
  slug: "E--work-shop",
  project_path: "E:\\work\\shop",
  memory_dir: "",
  index: null,
  instructions: [],
  memories: [],
  findings: [],
  always_on: 0,
  ...over,
});

describe("memory helpers", () => {
  it("drops frontmatter, with LF or CRLF", () => {
    expect(memoryBody("---\nname: a\n---\n\nBody text\n")).toBe("Body text");
    expect(memoryBody("---\r\nname: a\r\nmetadata:\r\n  type: user\r\n---\r\nBody")).toBe("Body");
    expect(memoryBody("No frontmatter")).toBe("No frontmatter");
  });

  it("labels a project by its folder, or by Claude's folder name when unknown", () => {
    expect(projectLabel(project())).toBe("shop");
    expect(projectLabel(project({ project_path: null }))).toBe("E--work-shop");
  });

  it("searches names, descriptions, kinds and the project", () => {
    expect(memoryMatches(project(), memory(), "deployed")).toBe(true);
    expect(memoryMatches(project(), memory(), "SHOP")).toBe(true);
    expect(memoryMatches(project(), memory(), "feedback")).toBe(false);
    expect(memoryMatches(project(), null, "deployed")).toBe(false);
    expect(memoryMatches(project(), memory(), "  ")).toBe(true);
  });

  it("starts a skill from a memory with a valid name", () => {
    const seed = memorySkillSeed(memory({ name: null, file: "Deploy_Pipeline.md" }), "---\nname: x\n---\nSteps");
    expect(seed).toEqual({ name: "deploy-pipeline", description: "How the site is deployed", body: "Steps" });
  });
});
