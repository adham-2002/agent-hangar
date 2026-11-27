<h1 align="center">Agent Hangar</h1>

<p align="center">
  One place to equip, inspect and maintain your AI coding agents —
  Claude Code, Codex, Cursor, Gemini CLI and the rest.
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文说明</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/adham-2002/skills-manager/releases/latest">Download</a>
</p>

> Agent Hangar started as a fork of
> [skills-manager](https://github.com/xingkongliang/skills-manager) by
> Tianliang Zhang, released under the MIT License. Thank you to the original
> author and contributors — the skill library, workspaces, sync and backup
> engine all come from that project. Agent Hangar is maintained separately and
> is not endorsed by the original author.

## What it does

**Equip** — what each agent carries into a session
- **Skill library** — install skills from Git repos, local folders, `.zip` / `.skill` archives or the [skills.sh](https://skills.sh) marketplace into one central library, then deploy them to any agent by symlink or copy.
- **Packs** — skills from one source form a pack. The Library shows one card per pack with its health ("3 issues", "2 updates") and turns a whole pack on or off in one click.
- **Presets** — named sets of skills you switch per agent or per project. The sidebar dot shows how heavy each preset is (green / amber / red) and warns when its skills clash.
- **Claude Code plugins** — see every installed plugin and what it bundles, enable, update or remove them, with marketplace commands shown before they run.

**Inspect** — know what your agents actually load
- **Insights** — context cost of everything that loads every session, per agent and per preset.
- **Quality checks** — lint skills for vague descriptions, oversized bodies, broken links and skills that trigger on the same requests.
- **Memory** — review Claude Code's per-project memory and `CLAUDE.md` files: stale paths, secrets, duplicates, an index that is too long. Delete safely (kept in a trash folder) or promote a memory to your global `CLAUDE.md` or to a skill.

**Maintain**
- **Backup & multi-device sync** to a private GitHub repository or any Git remote, with skill-aware merges.
- **Update tracking** for Git-based skills and plugins.
- **CLI** — `skills-manager-cli` drives the same library from a terminal, so your agents can install and deploy skills themselves without writing behind the app's back.

## Install

Download the Windows installer from the
[latest release](https://github.com/adham-2002/skills-manager/releases/latest).

To build from source you need Node.js 20+, Rust stable and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/):

```bash
npm install
npm run tauri:dev      # run in development
npm run tauri build    # build an installer
```

Your library lives in `~/.skills-manager` (the folder name is kept from the
original project so existing installs keep their data).

## Following the original project

New features and fixes from the original repository can be brought in one at a
time without disturbing Agent Hangar's own changes. See
[docs/UPSTREAM.md](docs/UPSTREAM.md), or run:

```bash
npm run upstream
```

## License

MIT — see [LICENSE](LICENSE). The original copyright notice is kept as the
license requires.
