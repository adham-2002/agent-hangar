/**
 * The "Original project" page's view of `npm run upstream -- --json`: which
 * commits in skills-manager are not yet in the user's Agent Hangar source.
 */

/** How a commit fits the user's code, as the report's in-memory trial found. */
export type UpstreamState = "clean" | "after_earlier" | "conflicts" | "suggest_skip";

export interface UpstreamCommit {
  sha: string;
  subject: string;
  date: string;
  /** Conventional-commit type: feat, fix, perf, … or "other". */
  kind: string;
  files: string[];
  touches_your_files: string[];
  state: UpstreamState;
  conflicts: string[];
  hint: string | null;
}

export interface UpstreamReport {
  fork_point: string;
  branch: string;
  upstream_head: { sha: string; subject: string; date: string };
  checked_at: string;
  skipped: { sha: string; reason: string }[];
  /** Oldest first, the order they must be picked in. */
  commits: UpstreamCommit[];
}

export const UPSTREAM_COMMIT_URL = "https://github.com/xingkongliang/skills-manager/commit/";

export const shortSha = (sha: string) => sha.slice(0, 7);

/** Commits worth deciding on, i.e. everything not suggested to skip. */
export function pending(report: UpstreamReport): UpstreamCommit[] {
  return report.commits.filter((c) => c.state !== "suggest_skip");
}

export function counts(report: UpstreamReport) {
  const out = { clean: 0, after_earlier: 0, conflicts: 0, suggest_skip: 0 };
  for (const c of report.commits) out[c.state] += 1;
  return out;
}

/** Strips "type(scope): " and a trailing "(#123)" so the change reads as words. */
export function plainSubject(subject: string): string {
  return subject
    .replace(/^\w+(\([^)]*\))?!?:\s*/, "")
    .replace(/(\s*\(#\d+\))+\s*$/, "")
    .trim();
}

/** The selected commits in upstream order, which is the order to pick them. */
export function inPickOrder(report: UpstreamReport, selected: ReadonlySet<string>): UpstreamCommit[] {
  return report.commits.filter((c) => selected.has(c.sha));
}

export function pickCommand(commits: UpstreamCommit[]): string {
  return `npm run upstream -- pick ${commits.map((c) => shortSha(c.sha)).join(" ")}`;
}

export function skipCommand(commit: UpstreamCommit, reason: string): string {
  return `npm run upstream -- skip ${shortSha(commit.sha)} "${reason.replace(/"/g, "'")}"`;
}

/** A request the user can paste to their agent; the agent-hangar skill handles it. */
export function agentRequest(commits: UpstreamCommit[]): string {
  const list = commits.map((c) => `- ${shortSha(c.sha)} ${plainSubject(c.subject)}`).join("\n");
  return `Check skills-manager for updates and take these commits into Agent Hangar, then run the tests and open a PR:\n${list}`;
}
