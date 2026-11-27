import { describe, expect, it } from "vitest";
import {
  agentRequest,
  counts,
  inPickOrder,
  pending,
  pickCommand,
  plainSubject,
  skipCommand,
  type UpstreamCommit,
  type UpstreamReport,
} from "./upstream";

const commit = (sha: string, state: UpstreamCommit["state"], subject = "fix(x): do a thing (#1)"): UpstreamCommit => ({
  sha: sha.padEnd(40, "0"),
  subject,
  date: "2026-11-22",
  kind: "fix",
  files: [],
  touches_your_files: [],
  state,
  conflicts: [],
  hint: null,
});

const report = (commits: UpstreamCommit[]): UpstreamReport => ({
  fork_point: "f".repeat(40),
  branch: "main",
  upstream_head: { sha: "a".repeat(40), subject: "x", date: "2026-11-22" },
  checked_at: "2026-11-27T00:00:00Z",
  skipped: [],
  commits,
});

describe("upstream report helpers", () => {
  it("reads a commit subject as words", () => {
    expect(plainSubject("feat(agents): let users pick an icon for custom agents (#444)")).toBe(
      "let users pick an icon for custom agents",
    );
    expect(plainSubject("fix(install): keep ids inside the library (#422) (#689)")).toBe(
      "keep ids inside the library",
    );
    expect(plainSubject("Plain subject")).toBe("Plain subject");
  });

  it("counts states and leaves suggested skips out of what is pending", () => {
    const r = report([commit("1", "clean"), commit("2", "conflicts"), commit("3", "suggest_skip")]);
    expect(counts(r)).toEqual({ clean: 1, after_earlier: 0, conflicts: 1, suggest_skip: 1 });
    expect(pending(r).map((c) => c.sha[0])).toEqual(["1", "2"]);
  });

  it("builds the pick command in upstream order, whatever order they were selected in", () => {
    const r = report([commit("aaaaaaa1", "clean"), commit("bbbbbbb2", "after_earlier")]);
    const picked = inPickOrder(r, new Set([r.commits[1].sha, r.commits[0].sha]));
    expect(pickCommand(picked)).toBe("npm run upstream -- pick aaaaaaa bbbbbbb");
  });

  it("quotes a skip reason safely and writes a request for the agent", () => {
    const c = commit("ccccccc3", "conflicts", "feat(library): new sheet (#687)");
    expect(skipCommand(c, 'we have "our" design')).toBe(`npm run upstream -- skip ccccccc "we have 'our' design"`);
    expect(agentRequest([c])).toContain("- ccccccc new sheet");
  });
});
