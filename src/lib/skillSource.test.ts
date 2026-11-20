import { describe, expect, it } from "vitest";
import { buildSourceGroups, defaultGroupBySource, sourceCandidates } from "./skillSource";
import type { ManagedSkill } from "./tauri";

const skill = (id: string, source_ref: string | null, source_type = "git"): ManagedSkill => ({
  id,
  name: id,
  description: null,
  source_type,
  source_ref,
  source_ref_resolved: null,
  source_subpath: null,
  source_branch: null,
  source_revision: null,
  remote_revision: null,
  update_status: "local_only",
  last_checked_at: null,
  last_check_error: null,
  central_path: `/fixture/${id}`,
  enabled: true,
  created_at: 0,
  updated_at: 0,
  status: "ok",
  targets: [],
  preset_ids: [],
  tags: [],
});

describe("sourceCandidates", () => {
  it("offers one row per Source, with its skill count", () => {
    const skills = [
      skill("a", "https://github.com/owner/repo"),
      skill("b", "git@github.com:owner/repo.git"),
      skill("c", "https://github.com/other/repo"),
    ];
    expect(sourceCandidates(skills)).toEqual([
      { key: "repo:github.com/owner/repo", label: "owner/repo", count: 2 },
      { key: "repo:github.com/other/repo", label: "other/repo", count: 1 },
    ]);
  });

  it("puts the leftover bucket last, unlabelled", () => {
    const skills = [skill("a", "https://github.com/owner/repo"), skill("b", null, "well-known")];
    expect(sourceCandidates(skills).at(-1)).toEqual({ key: "unknown", label: null, count: 1 });
  });

  it("has nothing to offer for an empty list", () => {
    expect(sourceCandidates([])).toEqual([]);
  });
});

describe("defaultGroupBySource", () => {
  it("groups once one known source holds more than one skill", () => {
    const groups = buildSourceGroups([
      skill("a", "https://github.com/obra/superpowers"),
      skill("b", "git@github.com:obra/superpowers.git"),
    ]);
    expect(defaultGroupBySource(groups)).toBe(true);
  });

  it("stays flat for single skills and for the unknown bucket", () => {
    const groups = buildSourceGroups([
      skill("a", "https://github.com/one/a"),
      skill("b", "https://github.com/two/b"),
      skill("x", null, "mystery"),
      skill("y", null, "mystery"),
    ]);
    expect(defaultGroupBySource(groups)).toBe(false);
  });
});
