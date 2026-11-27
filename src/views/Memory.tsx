import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import { useApp } from "../context/AppContext";
import * as api from "../lib/tauri";
import type { InstructionFile, MemoryFile, MemoryProject, MemoryReport, SkillFinding } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { formatTokens } from "../lib/insights";
import { memoryMatches, memorySkillSeed, projectLabel } from "../lib/memory";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusBanner } from "../components/StatusBanner";
import { SkillFindings } from "../components/SkillFindings";
import { SkillMarkdown } from "../components/SkillMarkdown";
import { SkillEditorDialog, type SkillEditorMode } from "../components/SkillEditorDialog";

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

type Target = { project: MemoryProject; memory: MemoryFile };

function problems(findings: SkillFinding[]) {
  return findings.filter((f) => f.severity !== "info").length;
}

function projectProblems(project: MemoryProject) {
  return (
    problems(project.findings) +
    project.instructions.reduce((n, i) => n + problems(i.findings), 0) +
    project.memories.reduce((n, m) => n + problems(m.findings), 0)
  );
}

function sorted(findings: SkillFinding[]) {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function Memory() {
  const { t } = useTranslation();
  const { refreshManagedSkills } = useApp();
  const [report, setReport] = useState<MemoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openMemory, setOpenMemory] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [promoting, setPromoting] = useState<Target | null>(null);
  const [editor, setEditor] = useState<SkillEditorMode | null>(null);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.getAgentMemory());
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e, ""));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const keyOf = (project: MemoryProject, memory: MemoryFile) => `${project.slug}/${memory.file}`;

  const projects = useMemo(() => {
    if (!report) return [];
    return report.projects
      .map((project) => ({
        project,
        memories: project.memories.filter(
          (m) =>
            memoryMatches(project, m, query) &&
            (!onlyProblems || problems(m.findings) > 0),
        ),
        showProject:
          memoryMatches(project, null, query) &&
          (!onlyProblems || problems(project.findings) + project.instructions.reduce((n, i) => n + problems(i.findings), 0) > 0),
      }))
      .filter((p) => p.memories.length > 0 || p.showProject);
  }, [report, query, onlyProblems]);

  const totals = useMemo(() => {
    const all = report?.projects ?? [];
    return {
      projects: all.length,
      memories: all.reduce((n, p) => n + p.memories.length, 0),
      problems:
        all.reduce((n, p) => n + projectProblems(p), 0) +
        (report?.global ?? []).reduce((n, g) => n + problems(g.findings), 0),
      heaviest: all.reduce((n, p) => Math.max(n, p.always_on), 0),
    };
  }, [report]);

  const loadContent = async (project: MemoryProject, memory: MemoryFile) => {
    const key = keyOf(project, memory);
    if (content[key] !== undefined) return content[key];
    const text = await api.readAgentMemory(project.slug, memory.file);
    setContent((c) => ({ ...c, [key]: text }));
    return text;
  };

  const toggleOpen = async (project: MemoryProject, memory: MemoryFile) => {
    const key = keyOf(project, memory);
    if (openMemory === key) {
      setOpenMemory(null);
      return;
    }
    setOpenMemory(key);
    try {
      await loadContent(project, memory);
    } catch (e) {
      toast.error(getErrorMessage(e, t("memory.readFailed")));
      setOpenMemory(null);
    }
  };

  const makeSkill = async (project: MemoryProject, memory: MemoryFile) => {
    try {
      const text = await loadContent(project, memory);
      setEditor({ kind: "create", seed: memorySkillSeed(memory, text) });
    } catch (e) {
      toast.error(getErrorMessage(e, t("memory.readFailed")));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      const backup = await api.deleteAgentMemory(deleting.project.slug, deleting.memory.file);
      toast.success(t("memory.deleted", { name: deleting.memory.name ?? deleting.memory.file }), {
        description: t("memory.backupAt", { path: backup }),
      });
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, t("memory.deleteFailed")));
    }
  };

  const confirmPromote = async () => {
    if (!promoting) return;
    try {
      await api.moveAgentMemoryToGlobal(promoting.project.slug, promoting.memory.file);
      toast.success(t("memory.promoted", { name: promoting.memory.name ?? promoting.memory.file }));
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, t("memory.promoteFailed")));
    }
  };

  const relative = (seconds: number | null) => {
    if (seconds === null) return null;
    const days = Math.floor((now - seconds) / 86_400);
    return days <= 0 ? t("insights.today") : t("insights.daysAgo", { count: days });
  };

  const instructionRow = (file: InstructionFile) => (
    <li key={file.path} className="flex flex-col gap-1 rounded-lg bg-surface-hover/40 px-2.5 py-2">
      <div className="flex items-center gap-2 text-[12px]">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="min-w-0 truncate font-mono text-secondary" title={file.path}>
          {file.path}
        </span>
        <span className="ml-auto shrink-0 tabular-nums text-muted">
          {t("memory.everySession", { tokens: formatTokens(file.tokens) })}
        </span>
      </div>
      <SkillFindings findings={sorted(file.findings)} />
    </li>
  );

  const memoryRow = (project: MemoryProject, memory: MemoryFile) => {
    const key = keyOf(project, memory);
    const isOpen = openMemory === key;
    const text = content[key];
    const suggestGlobal = memory.findings.some((f) => f.code === "global_candidate" || f.code === "similar_memory");
    return (
      <li key={key} className="rounded-lg border border-border-subtle px-2.5 py-2">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => void toggleOpen(project, memory)}
            aria-expanded={isOpen}
            className="flex min-w-0 flex-1 items-start gap-1.5 text-left outline-none"
          >
            {isOpen ? (
              <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
            ) : (
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
            )}
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-primary">{memory.name ?? memory.file}</span>
                {memory.kind ? (
                  <span className="rounded-full bg-surface-hover px-1.5 py-px text-[11px] text-muted">
                    {t(`memory.kinds.${memory.kind}`, { defaultValue: memory.kind })}
                  </span>
                ) : null}
              </span>
              {memory.description ? (
                <span className="mt-0.5 block text-[12px] text-secondary">{memory.description}</span>
              ) : null}
              <span className="mt-0.5 block text-[11px] text-muted">
                {[
                  memory.file,
                  t("memory.whenRead", { tokens: formatTokens(memory.tokens) }),
                  relative(memory.modified),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => void makeSkill(project, memory)}
              title={t("memory.makeSkill")}
              aria-label={t("memory.makeSkill")}
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-secondary"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPromoting({ project, memory })}
              title={t("memory.moveToGlobal")}
              aria-label={t("memory.moveToGlobal")}
              className={cn(
                "rounded-md p-1.5 transition-colors hover:bg-surface-hover",
                suggestGlobal ? "text-accent-light" : "text-muted hover:text-secondary",
              )}
            >
              <Globe className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setDeleting({ project, memory })}
              title={t("memory.delete")}
              aria-label={t("memory.delete")}
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-rose-500/10 hover:text-rose-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <SkillFindings findings={sorted(memory.findings)} className="mt-1.5 pl-5" />
        {isOpen ? (
          <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border-subtle bg-bg-secondary p-3 pl-4">
            {text === undefined ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted" />
            ) : (
              <SkillMarkdown content={text} />
            )}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="app-page">
      <div className="app-page-header flex items-center justify-between gap-3 pr-2">
        <div>
          <h1 className="app-page-title">{t("memory.title")}</h1>
          <p className="app-page-subtitle">{t("memory.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          title={t("plugins.refresh")}
          aria-label={t("plugins.refresh")}
          className="rounded-md p-1.5 text-muted transition-colors outline-none hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {error !== null ? (
        <StatusBanner
          tone="danger"
          title={t("memory.loadFailed")}
          description={error || undefined}
          actionLabel={t("common.retry")}
          onAction={() => void load()}
        />
      ) : null}

      {loading && !report ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("memory.loading")}
        </div>
      ) : null}

      {report ? (
        <>
          <section aria-label={t("memory.summary")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [t("memory.stats.global"), report.global.length ? formatTokens(report.global_always_on) : t("memory.none")],
              [t("memory.stats.projects"), String(totals.projects)],
              [t("memory.stats.memories"), String(totals.memories)],
              [t("memory.stats.problems"), String(totals.problems)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border-subtle bg-surface p-3">
                <div className="text-[11px] text-muted">{label}</div>
                <div className="text-[17px] font-semibold tabular-nums text-primary">{value}</div>
              </div>
            ))}
          </section>
          <p className="text-[12px] text-muted">{t("memory.hint")}</p>

          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("memory.search")}
                aria-label={t("memory.search")}
                className="w-full rounded-lg border border-border-subtle bg-surface py-1.5 pl-8 pr-3 text-[13px] text-primary outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-secondary">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
              {t("memory.onlyProblems")}
            </label>
          </div>

          <section aria-label={t("memory.globalTitle")} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted" />
              <h2 className="text-[14px] font-semibold text-primary">{t("memory.globalTitle")}</h2>
            </div>
            {report.global.length === 0 ? (
              <p className="text-[12px] text-muted">{t("memory.noGlobal")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">{report.global.map(instructionRow)}</ul>
            )}
          </section>

          <section aria-label={t("memory.projectsTitle")} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted" />
              <h2 className="text-[14px] font-semibold text-primary">{t("memory.projectsTitle")}</h2>
            </div>
            {projects.length === 0 ? (
              <p className="text-[13px] text-muted">
                {report.projects.length === 0 ? t("memory.empty") : t("memory.noMatch")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {projects.map(({ project, memories }) => {
                  const isCollapsed = (collapsed[project.slug] ?? false) && !query;
                  const count = projectProblems(project);
                  return (
                    <li key={project.slug} className="rounded-xl border border-border-subtle bg-surface p-3">
                      <button
                        type="button"
                        onClick={() => setCollapsed((c) => ({ ...c, [project.slug]: !isCollapsed }))}
                        aria-expanded={!isCollapsed}
                        className="flex w-full items-center gap-2 text-left outline-none"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-primary">{projectLabel(project)}</span>
                          <span className="block truncate text-[11px] text-muted" title={project.project_path ?? project.slug}>
                            {project.project_path ?? t("memory.folderUnknown", { slug: project.slug })}
                          </span>
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-3 text-[12px] text-muted">
                          {count > 0 ? (
                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {count}
                            </span>
                          ) : null}
                          <span className="tabular-nums">{t("memory.count", { count: project.memories.length })}</span>
                          <span className="tabular-nums">
                            {t("memory.everySession", { tokens: formatTokens(project.always_on) })}
                          </span>
                        </span>
                      </button>
                      {!isCollapsed ? (
                        <div className="mt-2 flex flex-col gap-2 pl-6">
                          <SkillFindings findings={sorted(project.findings)} />
                          {project.instructions.length > 0 ? (
                            <ul className="flex flex-col gap-1.5">{project.instructions.map(instructionRow)}</ul>
                          ) : null}
                          {memories.length > 0 ? (
                            <ul className="flex flex-col gap-1.5">{memories.map((m) => memoryRow(project, m))}</ul>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={t("memory.deleteTitle")}
        message={t("memory.deleteConfirm", {
          name: deleting?.memory.name ?? deleting?.memory.file ?? "",
          project: deleting ? projectLabel(deleting.project) : "",
        })}
        confirmLabel={t("memory.delete")}
        tone="danger"
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={promoting !== null}
        title={t("memory.moveTitle")}
        message={t("memory.moveConfirm", {
          name: promoting?.memory.name ?? promoting?.memory.file ?? "",
          project: promoting ? projectLabel(promoting.project) : "",
        })}
        confirmLabel={t("memory.moveToGlobal")}
        tone="warning"
        onClose={() => setPromoting(null)}
        onConfirm={confirmPromote}
      />
      <SkillEditorDialog
        mode={editor}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          toast.success(t("memory.skillCreated"));
          await refreshManagedSkills();
        }}
      />
    </div>
  );
}
