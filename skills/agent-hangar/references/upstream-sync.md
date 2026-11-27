# Taking updates from skills-manager into Agent Hangar

Agent Hangar's source is built on
[xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager)
(MIT). This is how to check that project for new commits and bring the useful
ones into Agent Hangar's code without breaking its own changes. It applies only
inside an Agent Hangar checkout: a repo with `scripts/upstream.mjs` and an
`upstream` git remote. The full guide is `docs/UPSTREAM.md` in that repo.

## 1. Report

From the repo root, on a clean work tree:

```bash
npm run upstream            # fetches upstream, lists what is new
```

Each listed commit is marked:
- `✓` applies cleanly
- `↳` applies only after an earlier commit in the list; pick them together, in order
- `!` conflicts in the listed files

"Up to date" means every upstream commit is either taken or skipped. Tell the
user that, along with upstream's newest commit (`git log -1 --oneline upstream/main`).

## 2. Recommend before taking anything

Read each commit with `npm run upstream -- show <sha>`, then give the user a
short table: what it does, whether it fits, and your recommendation.

- **Take** bug fixes, safety fixes, and features that don't touch the areas
  Agent Hangar redesigned.
- **Suggest skipping** commits that rework UI Agent Hangar has its own version
  of (the Library, the skill detail sheet), release bookkeeping, and upstream's
  own branding, links or CI.
- Record a skip so it is never offered again:
  `npm run upstream -- skip <sha> "<reason>"`, then commit `.upstream/skipped.txt`.

Ask before picking, unless the user already asked you to take what fits.

## 3. Pick on a branch

```bash
git checkout -b upstream/<topic>
npm run upstream -- pick <sha> [<sha>...]     # cherry-pick -x, oldest first
```

`pick` stops at the first conflict and lists the files. Resolve it, run
`git add <files>` and `git cherry-pick --continue`, then pick the rest.

### Resolving conflicts: the patterns seen so far

- **Keep Agent Hangar's names in user-visible text.** Where upstream's text says
  "Skills Manager", write "Agent Hangar". `src/lib/brand.test.ts` fails if the
  old name reaches a locale file. Internal names stay as upstream has them:
  `skills-manager-cli`, `~/.skills-manager`, Rust modules, git signatures.
- **Both sides added code at the same spot** (tests, imports): keep both.
- **Upstream moved code the fork extended into a helper:** take upstream's
  helper and move the fork's addition into it. For example, the plugin backup
  step `plugin_backup::write_device_manifest` sits in the backup helpers
  `init_backup_repo` and `commit_with_metadata_unlocked`.
- **Upstream patched code the fork rewrote:** keep the fork's version and add
  upstream's intent to it. For example, the outside-library guard
  `library_dir()` went into the fork's `delete_one_skill`.
- **The commit depends on a skipped one:** take only the independent part. For
  example, the backend diff limits were taken, but not the tests and layout of
  the skipped Files tab. Say what was left out.
- **A new field in a shared type** (for example `icon` on `ToolInfo`): add it to
  the fork's test fixtures, and add `useOptionalApp: () => null` to the
  `AppContext` mocks, in a separate commit.

## 4. "Applies cleanly" is not "builds"

The report checks text only. After the picks, run everything:

```bash
npm test && npm run lint && npx tsc -b
cd src-tauri && cargo test --lib && cargo test --bin skills-manager-cli
```

Two Rust tests always fail on Windows and are not caused by a pick:
`remove_workspace_skill_target_removes_directory_symlink_without_touching_target`
and `remove_target_removes_directory_symlink`.

If something calls a function or type that doesn't exist, find the upstream
commit that adds it with `git log upstream/main -S <name> --oneline`, pick that
commit first, and redo.

## 5. Ship

1. Bump the patch version in `package.json`, `package-lock.json` (two places),
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json`.
2. Add a `## [x.y.z] - <date>` entry to both `CHANGELOG.md` and
   `CHANGELOG-zh.md`. Use only these headings: `### Release Overview` /
   `### User-facing` / `### Developer & Governance` and `### 发布概览` /
   `### 用户可见更新` / `### 开发者与治理更新`.
3. Push the branch and open a PR. The body names each picked sha, what was
   merged by hand, and what was skipped. Merge it with `--merge` (not squash),
   so the `cherry picked from` trailers survive.
4. Build the installer only if the user asks. Publish a GitHub release only
   with the user's explicit OK. Don't push tags by hand: `v*` tags start
   `release.yml`.

## Report back

Say what was taken, merged by hand, skipped and why, the test results, and the
PR link. A weekly `Upstream watch` workflow also opens an "Upstream updates"
issue on GitHub when there is something new.
