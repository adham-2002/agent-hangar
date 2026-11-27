# Taking updates from skills-manager into Agent Hangar

Agent Hangar's source is built on
[xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager)
(MIT). This is how to check that project for new commits and bring the useful
ones into Agent Hangar's code without breaking its own changes. It applies only
inside an Agent Hangar checkout: a repo with `scripts/upstream.mjs` and an
`upstream` git remote. The full guide is `docs/UPSTREAM.md` in that repo.

## 1. Pull the original project's code

From the Agent Hangar repo root, on a clean work tree:

```bash
git fetch upstream                              # download skills-manager's latest code
npm run upstream -- --no-fetch --json --all     # every new commit, tested against our code
git log -1 --format='%h %as %s' upstream/main   # skills-manager's newest commit
```

The JSON lists each commit not yet taken or skipped, oldest first. Each entry
has `subject`, `kind`, `files`, `touches_your_files`, `state` and `conflicts`.
`state` is one of:
- `clean`: applies as is
- `after_earlier`: applies once the commits before it are in
- `conflicts`: clashes in the listed files
- `suggest_skip`: release bookkeeping, docs or CI

A commit recorded in `.upstream/skipped.txt` shows only with `--all`, and its
hint begins `skipped:`.

If there are no commits, the report is just "Up to date", plus skills-manager's
newest commit.

## 2. Write the full report

Don't change any code in this step. For every pending commit:

1. **Read it:** `git show --stat <sha>`, then `git show <sha>` for the files
   that matter. Work out what it does for a user, in one plain sentence.
2. **Group the commits that belong together.** A follow-up that names an
   earlier PR, a commit that only applies `after_earlier`, and a fix to a
   feature in the same list all form one item.
3. **Check it against Agent Hangar's own features**, listed below. A commit
   clashes with a feature when it changes that feature's files or redoes the
   same thing differently, even if git says `clean`.
4. **Place it in one group:**
   - **Safe to add:** `clean`, and touches none of Agent Hangar's own
     features.
   - **Add with care:** `clean` or `after_earlier`, but touches files Agent
     Hangar also changed (`touches_your_files`). Name the area to re-test.
   - **Conflicts with our features:** `conflicts`, or redoes something Agent
     Hangar already does its own way. Name our feature, then say whether the
     intent can be carried over by hand or whether it should be skipped.
   - **Skip:** release bookkeeping, upstream branding, links or CI, docs only,
     or already recorded as skipped.

Then present it like this:

```
skills-manager: N new commits (newest <sha> <date>)

Safe to add
| Commits | What it adds | Notes |
Add with care
| Commits | What it adds | Re-test |
Conflicts with our features
| Commits | What it adds | Clashes with | Carry over by hand? |
Skip
| Commits | Why |

Recommendation: take <list>; skip <list>, because <reason>.
```

End by asking which to take. If the user already said "take what fits",
take **Safe to add** and **Add with care**, and ask about the rest. Record
every agreed skip with `npm run upstream -- skip <sha> "<reason>"`, then
commit `.upstream/skipped.txt`.

### Agent Hangar's own features (compare against these)

Keep this list current: add an entry whenever Agent Hangar gains a feature of
its own.

| Feature | Main files |
|---|---|
| Name, credit, repo links (Agent Hangar) | `src/i18n/*.json`, `src-tauri/tauri.conf.json`, `src/lib/appRepo.ts`, `README*` |
| Library: one card per pack, health line, Individual skills card, Filter / Updates menus | `src/views/MySkills.tsx`, `src/components/SkillRowsLayout.tsx`, `SourceGroupHeader.tsx`, `PluginPackSection.tsx`, `src/lib/skillRows.ts`, `agentSummary.ts`, `filterChips.ts` |
| Skill detail sheet (our layout; upstream's Files tab was skipped) | `src/components/SkillDetailPanel.tsx` |
| Claude Code plugins and plugin backup | `src-tauri/src/core/plugin_*.rs`, `commands/plugins.rs`, `src/views/Plugins.tsx` |
| Insights, preset budgets, sidebar weight dots | `src/views/Insights.tsx`, `src/lib/insights.ts`, `presetLoad.ts`, `components/PresetBudget*.tsx`, `commands/authoring.rs` |
| Skill quality checks, authoring, `skills lint` / `create` | `src-tauri/src/core/skill_lint.rs`, `commands/authoring.rs`, `src/components/SkillEditorDialog.tsx` |
| Memory page | `src-tauri/src/core/agent_memory.rs`, `commands/memory.rs`, `src/views/Memory.tsx` |
| Skill delete (moves aside first, keeps edited copies) | `delete_one_skill` in `src-tauri/src/commands/skills.rs` |
| Update check on a fork (`version_from_tag`) | `src-tauri/src/commands/settings.rs` |
| Backup status shows the last backup time | `src/views/Backup.tsx` |
| Upstream tooling and this skill | `scripts/upstream.mjs`, `docs/UPSTREAM.md`, `skills/agent-hangar/` |

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
