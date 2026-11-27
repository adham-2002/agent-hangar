<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/agent-hangar-icon-dark.png" />
    <img src="assets/brand/agent-hangar-icon-light.png" width="96" alt="Agent Hangar logo" />
  </picture>
</p>

<h1 align="center">Agent Hangar</h1>

<p align="center">
  一个地方装备、检查和维护你的 AI 编程 Agent ——
  Claude Code、Codex、Cursor、Gemini CLI 等。
</p>

<p align="center">
  <a href="./README.md">English</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/adham-2002/agent-hangar/releases/latest">下载</a>
</p>

## 功能

**装备** —— 每个 Agent 在会话中加载什么
- **Skill 库**：从 Git 仓库、本地文件夹、`.zip` / `.skill` 压缩包或 [skills.sh](https://skills.sh) 安装到统一的中央库，再以软链接或复制方式部署到任意 Agent。
- **Skill 包**：同一来源的 Skills 组成一个包，库视图中每个包一张卡片，显示健康状态，并可一键整体开关。
- **Preset**：按 Agent 或项目切换的 Skill 组合。侧边栏圆点显示每个 Preset 的负载（绿 / 黄 / 红），并提示 Skill 冲突。
- **Claude Code 插件**：查看、启用、更新或移除已安装插件。

**检查** —— 了解 Agent 实际加载了什么
- **洞察**：每个 Agent、每个 Preset 每次会话的上下文开销。
- **质量检查**：发现描述含糊、正文过长、链接失效以及互相冲突的 Skills。
- **记忆**：审查 Claude Code 的项目记忆与 `CLAUDE.md`，安全删除，或提升为全局 `CLAUDE.md` / Skill。

**维护**
- 备份与多设备同步（GitHub 私有仓库或任意 Git 远程）。
- Git 来源 Skills 与插件的更新追踪。
- `skills-manager-cli` 命令行工具。

## 安装

从 [最新版本](https://github.com/adham-2002/agent-hangar/releases/latest) 下载 Windows 安装包。数据保存在 `~/.skills-manager`。

## 引入 skills-manager 的更新

可以逐个引入 skills-manager 的新功能和修复，而不影响 Agent Hangar 自己的改动。详见 [docs/UPSTREAM.md](docs/UPSTREAM.md)，或运行 `npm run upstream`。

## 致谢

基于 Tianliang Zhang 的 [skills-manager](https://github.com/xingkongliang/skills-manager)（MIT）构建，感谢原作者和贡献者。

## 许可证

MIT —— 见 [LICENSE](LICENSE)，按许可证要求保留原版权声明。
