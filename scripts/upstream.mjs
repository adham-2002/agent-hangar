#!/usr/bin/env node
// Follows the original project (xingkongliang/skills-manager) so its new
// features and fixes can be taken one commit at a time. See docs/UPSTREAM.md.
//
//   npm run upstream                      report new upstream commits
//   npm run upstream -- show <sha>        what one commit changes
//   npm run upstream -- pick <sha>...     cherry-pick commits onto this branch
//   npm run upstream -- skip <sha> <why>  stop listing a commit you don't want
//
// Report flags: --markdown (for the GitHub issue), --json (for the app), --no-fetch, --all (include
// commits suggested to skip).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const UPSTREAM_URL = "https://github.com/xingkongliang/skills-manager.git";
const REMOTE = "upstream";
const BRANCH = `${REMOTE}/main`;
const SKIPPED_FILE = path.join(process.cwd(), ".upstream", "skipped.txt");

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).trimEnd();
  } catch (err) {
    if (allowFail) return { failed: true, status: err.status, stdout: String(err.stdout ?? "").trimEnd(), stderr: String(err.stderr ?? "") };
    throw err;
  }
}

function ensureRemote(fetch) {
  const remotes = git(["remote"]).split("\n");
  if (!remotes.includes(REMOTE)) git(["remote", "add", REMOTE, UPSTREAM_URL]);
  if (fetch) git(["fetch", "--quiet", REMOTE]);
}

function readSkipped() {
  if (!fs.existsSync(SKIPPED_FILE)) return new Map();
  const map = new Map();
  for (const line of fs.readFileSync(SKIPPED_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{7,40})\s+(.*)$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function isSkipped(skipped, sha) {
  for (const key of skipped.keys()) if (sha.startsWith(key)) return skipped.get(key);
  return null;
}

/** Upstream commits already on this branch, found by `-x` trailer. */
function pickedShas() {
  const log = git(["log", "--format=%B", `${BRANCH}..HEAD`]);
  return new Set([...log.matchAll(/cherry picked from commit ([0-9a-f]{40})/g)].map((m) => m[1]));
}

/** Files this fork changed itself (not counting commits taken from upstream). */
function ownFiles(base) {
  const out = git(["log", "--no-merges", "--format=%x00%B%x01", "--name-only", `${base}..HEAD`]);
  const files = new Set();
  for (const chunk of out.split("\x00").slice(1)) {
    const [body, names = ""] = chunk.split("\x01");
    if (/cherry picked from commit/.test(body)) continue;
    for (const f of names.split("\n").map((s) => s.trim()).filter(Boolean)) files.add(f);
  }
  return files;
}

function kindOf(subject) {
  const m = subject.match(/^(\w+)(\([^)]*\))?!?:/);
  return m ? m[1].toLowerCase() : "other";
}

// Release bookkeeping and the original project's own branding/CI always
// conflict with the fork and carry no feature, so they are suggested to skip.
const SKIP_HINTS = [
  [/^chore(\(release\))?: (release|bump)/i, "release bookkeeping (versions differ in the fork)"],
  [/^release\b|\brelease v?\d+\.\d+/i, "release bookkeeping (versions differ in the fork)"],
];
const SKIP_ONLY_PATHS = /^(README|CHANGELOG)[^/]*\.md$|^assets\/|^\.github\/|^docs\//;

function skipHint(subject, files) {
  for (const [re, why] of SKIP_HINTS) if (re.test(subject)) return why;
  if (files.length && files.every((f) => SKIP_ONLY_PATHS.test(f))) return "only docs, README, CI or assets";
  return null;
}

/**
 * Simulates `git cherry-pick sha` onto `onto` without touching the work tree.
 * Returns the resulting tree when it applies cleanly.
 */
function trialPick(sha, onto = "HEAD") {
  const res = git(["merge-tree", "--write-tree", "--name-only", "--no-messages", `--merge-base=${sha}^`, onto, sha], { allowFail: true });
  if (typeof res === "string") return { clean: true, conflicts: [], tree: res.split("\n")[0] };
  if (res.status !== 1) return { clean: false, conflicts: ["(could not test: " + res.stderr.trim() + ")"] };
  return { clean: false, conflicts: res.stdout.split("\n").slice(1).filter(Boolean) };
}

/**
 * Some commits build on earlier upstream ones, so they only apply after those.
 * Replays the commits in upstream order on a throwaway chain to find them.
 */
function chainTrials(commits) {
  let tip = git(["rev-parse", "HEAD"]);
  for (const c of commits) {
    if (!c.trial) continue;
    const t = trialPick(c.sha, tip);
    if (!t.clean) continue;
    if (!c.trial.clean) c.afterEarlier = true;
    // A dangling commit, never on a branch; git gc removes it.
    tip = git(["commit-tree", t.tree, "-p", tip, "-m", "upstream trial"]);
  }
}

function collect({ all }) {
  const base = git(["merge-base", "HEAD", BRANCH]);
  const skipped = readSkipped();
  const picked = pickedShas();
  // `git cherry` also hides commits whose patch is already here under another sha.
  const pending = git(["cherry", "HEAD", BRANCH])
    .split("\n")
    .filter((l) => l.startsWith("+ "))
    .map((l) => l.slice(2));
  const merges = new Set(git(["rev-list", "--merges", `HEAD..${BRANCH}`]).split("\n").filter(Boolean));
  const own = ownFiles(base);
  const commits = [];
  for (const sha of pending) {
    if (picked.has(sha) || merges.has(sha)) continue;
    const skippedWhy = isSkipped(skipped, sha);
    if (skippedWhy && !all) continue;
    const [subject, date] = git(["show", "-s", "--format=%s%x00%as", sha]).split("\x00");
    const files = git(["show", "--format=", "--name-only", sha]).split("\n").filter(Boolean);
    const hint = skippedWhy ? `skipped: ${skippedWhy}` : skipHint(subject, files);
    if (hint && !all && !skippedWhy) {
      commits.push({ sha, subject, date, files, kind: kindOf(subject), hint, overlap: [], trial: null });
      continue;
    }
    const overlap = files.filter((f) => own.has(f));
    commits.push({ sha, subject, date, files, kind: kindOf(subject), hint, overlap, trial: trialPick(sha) });
  }
  chainTrials(commits);
  return { base, commits };
}

function status(c) {
  if (!c.trial) return "suggest skip";
  if (c.trial.clean) return c.overlap.length ? "applies cleanly (touches your files)" : "applies cleanly";
  if (c.afterEarlier) return "applies cleanly after the earlier upstream commits (pick them in order)";
  return `conflicts: ${c.trial.conflicts.join(", ")}`;
}

function report(flags) {
  ensureRemote(!flags.has("--no-fetch"));
  const { base, commits } = collect({ all: flags.has("--all") });
  const useful = commits.filter((c) => c.trial);
  const skips = commits.filter((c) => !c.trial);
  if (flags.has("--json")) {
    // Read by the app's "Original project" page (commands/upstream.rs).
    const state = (c) => (!c.trial ? "suggest_skip" : c.trial.clean ? "clean" : c.afterEarlier ? "after_earlier" : "conflicts");
    const head = git(["log", "-1", "--format=%H%x00%s%x00%as", BRANCH]).split("\x00");
    console.log(
      JSON.stringify({
        fork_point: base,
        branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
        upstream_head: { sha: head[0], subject: head[1], date: head[2] },
        checked_at: new Date().toISOString(),
        skipped: [...readSkipped()].map(([sha, reason]) => ({ sha, reason })),
        commits: commits.map((c) => ({
          sha: c.sha,
          subject: c.subject,
          date: c.date,
          kind: c.kind,
          files: c.files,
          touches_your_files: c.overlap,
          state: state(c),
          conflicts: c.trial && !c.trial.clean && !c.afterEarlier ? c.trial.conflicts : [],
          hint: c.hint,
        })),
      }),
    );
    return;
  }
  if (flags.has("--markdown")) {
    const lines = [
      `${useful.length} upstream commit(s) not yet in this fork (fork point \`${base.slice(0, 7)}\`).`,
      "",
      "| Commit | Date | Change | Result |",
      "|---|---|---|---|",
      ...useful

        .map((c) => `| [\`${c.sha.slice(0, 7)}\`](https://github.com/xingkongliang/skills-manager/commit/${c.sha}) | ${c.date} | ${c.subject.replace(/\|/g, "\\|")} | ${status(c)} |`),
      "",
      skips.length ? `${skips.length} more suggested to skip (release bookkeeping, docs or CI).` : "",
      "",
      "Take one with `npm run upstream -- pick <sha>`, or hide it with `npm run upstream -- skip <sha> <reason>`.",
    ];
    console.log(lines.join("\n"));
    return;
  }
  if (!commits.length) {
    console.log("Up to date: every upstream commit is either taken or skipped.");
    return;
  }
  console.log(`Upstream commits not in this branch (fork point ${base.slice(0, 7)}):\n`);
  for (const c of useful) {
    const mark = c.trial.clean ? "✓" : c.afterEarlier ? "↳" : "!";
    console.log(`${mark} ${c.sha.slice(0, 7)}  ${c.date}  ${c.subject}`);
    console.log(`    ${status(c)}`);
  }
  if (skips.length) {
    console.log(`\nSuggested to skip:`);
    for (const c of skips) console.log(`  ${c.sha.slice(0, 7)}  ${c.subject}  (${c.hint})`);
  }
  console.log(`
✓ = applies cleanly, ↳ = applies after the earlier upstream commits, ! = needs a hand merge.
Next: npm run upstream -- show <sha>   |   pick <sha>...   |   skip <sha> <reason>`);
}

function pick(shas) {
  if (!shas.length) throw new Error("Name at least one commit: npm run upstream -- pick <sha>");
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) throw new Error("Commit or stash your changes first; picking needs a clean work tree.");
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main") console.log("Note: you are on main. A branch like upstream/<topic> keeps picks reviewable as a PR.");
  // Remember how each conflict was solved, so the same one resolves itself next time.
  git(["config", "rerere.enabled", "true"]);
  git(["config", "rerere.autoupdate", "true"]);
  // .gitattributes marks the fork's own README and changelog merge=ours.
  git(["config", "merge.ours.driver", "true"]);
  for (const sha of shas) {
    const full = git(["rev-parse", sha]);
    const res = git(["cherry-pick", "-x", full], { allowFail: true });
    if (typeof res === "string") {
      console.log(`✓ took ${full.slice(0, 7)} ${git(["show", "-s", "--format=%s", full])}`);
      continue;
    }
    const conflicted = git(["diff", "--name-only", "--diff-filter=U"]);
    console.log(`! ${full.slice(0, 7)} needs a hand merge in:\n${conflicted.split("\n").map((f) => "    " + f).join("\n")}`);
    console.log(`
Fix the files (keep "Agent Hangar" wherever upstream says "Skills Manager"), then:
    git add <files> && git cherry-pick --continue
Or give up on this commit:  git cherry-pick --abort`);
    const rest = shas.slice(shas.indexOf(sha) + 1);
    if (rest.length) console.log(`Then pick the rest: npm run upstream -- pick ${rest.join(" ")}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nRun the tests (npm test, cargo test) before merging.");
}

function skip(sha, reason) {
  if (!sha || !reason) throw new Error("Usage: npm run upstream -- skip <sha> <reason>");
  const full = git(["rev-parse", sha]);
  fs.mkdirSync(path.dirname(SKIPPED_FILE), { recursive: true });
  const header = fs.existsSync(SKIPPED_FILE) ? "" : "# Upstream commits this fork chose not to take: <sha> <reason>\n";
  fs.appendFileSync(SKIPPED_FILE, `${header}${full} ${reason}\n`);
  console.log(`Skipped ${full.slice(0, 7)}. Commit .upstream/skipped.txt to remember it.`);
}

const [cmd = "report", ...rest] = process.argv.slice(2);
try {
  if (cmd === "report" || cmd.startsWith("--")) report(new Set(cmd.startsWith("--") ? [cmd, ...rest] : rest));
  else if (cmd === "pick") pick(rest);
  else if (cmd === "skip") skip(rest[0], rest.slice(1).join(" "));
  else if (cmd === "show") {
    ensureRemote(false);
    console.log(git(["show", "--stat", "--format=%h %as %an%n%n%B", rest[0]]));
  } else throw new Error(`Unknown command "${cmd}". Use report, show, pick or skip.`);
} catch (err) {
  console.error(err.message || err);
  process.exitCode = 1;
}
