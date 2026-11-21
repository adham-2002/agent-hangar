import { describe, expect, it } from "vitest";
import type { ManagedSkill } from "./tauri";
import { packAgentState, packToggle } from "./packTargets";

const skill = (id: string, tools: string[]) =>
  ({ id, targets: tools.map((tool) => ({ tool })) }) as unknown as ManagedSkill;

const pack = [skill("a", ["claude_code"]), skill("b", ["claude_code", "codex"]), skill("c", [])];

describe("packAgentState", () => {
  it("reports all, some and none per agent", () => {
    expect(packAgentState(pack.slice(0, 2), "claude_code")).toBe("all");
    expect(packAgentState(pack, "claude_code")).toBe("some");
    expect(packAgentState(pack, "cursor")).toBe("none");
  });
});

describe("packToggle", () => {
  it("completes a partial pack, touching only the missing skills", () => {
    const { enable, skills } = packToggle(pack, "claude_code");
    expect(enable).toBe(true);
    expect(skills.map((s) => s.id)).toEqual(["c"]);
  });

  it("removes a fully deployed pack from the agent", () => {
    const { enable, skills } = packToggle(pack.slice(0, 2), "claude_code");
    expect(enable).toBe(false);
    expect(skills.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("deploys every skill of a pack the agent does not have", () => {
    const { enable, skills } = packToggle(pack, "cursor");
    expect(enable).toBe(true);
    expect(skills).toHaveLength(3);
  });
});
