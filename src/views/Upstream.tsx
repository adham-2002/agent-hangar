import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, FolderOpen, GitMerge, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { cn } from "../utils";
import * as api from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { UPSTREAM_REPO_URL } from "../lib/appRepo";
import {
  agentRequest,
  counts,
  inPickOrder,
  pending,
  pickCommand,
  plainSubject,
  shortSha,
  skipCommand,
  UPSTREAM_COMMIT_URL,
  type UpstreamCommit,
  type UpstreamReport,
  type UpstreamState,
} from "../lib/upstream";
import { StatusBanner } from "../components/StatusBanner";

const STATE_STYLE: Record<UpstreamState, string> = {
  clean: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  after_earlier: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  conflicts: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  suggest_skip: "bg-surface-hover text-muted",
};

async function copy(text: string, done: string) {
  try {
    await writeText(text);
    toast.success(done);
  } catch (e) {
    toast.error(getErrorMessage(e, ""));
  }
}

/**
 * New commits in skills-manager, the project Agent Hangar is built on, and
 * whether each fits the user's Agent Hangar source. Read-only: taking a
 * commit happens in the code, with the command or agent request it copies.
 */
export function Upstream() {
  const { t } = useTranslation();
  const [source, setSource] = useState<string | null | undefined>(undefined);
  const [report, setReport] = useState<UpstreamReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSkips, setShowSkips] = useState(false);

  const check = useCallback(
    async (fetch: boolean) => {
      setChecking(true);
      setError(null);
      try {
        const next = await api.checkUpstream(fetch);
        setReport(next);
        setSelected(new Set(pending(next).filter((c) => c.state === "clean").map((c) => c.sha)));
      } catch (e) {
        setError(getErrorMessage(e, t("upstream.checkFailed")));
      } finally {
        setChecking(false);
      }
    },
    [t],
  );

  useEffect(() => {
    api
      .getUpstreamSourceRepo()
      .then((path) => {
        setSource(path);
        // Without fetching first, so opening the page is instant and offline-safe.
        if (path) void check(false);
      })
      .catch(() => setSource(null));
  }, [check]);

  const chooseSource = async () => {
    const dir = await dialogOpen({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    try {
      await api.setUpstreamSourceRepo(dir);
      setSource(dir);
      await check(true);
    } catch (e) {
      toast.error(getErrorMessage(e, t("upstream.chooseFailed")));
    }
  };

  const toggle = (sha: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sha)) next.delete(sha);
      else next.add(sha);
      return next;
    });

  const chosen = useMemo(() => (report ? inPickOrder(report, selected) : []), [report, selected]);
  const tally = report ? counts(report) : null;
  const decide = report ? pending(report) : [];
  const skips = report ? report.commits.filter((c) => c.state === "suggest_skip") : [];

  const stateLabel = (c: UpstreamCommit) => {
    if (c.state === "conflicts") return t("upstream.state.conflicts", { files: c.conflicts.length });
    return t(`upstream.state.${c.state}`);
  };

  const row = (c: UpstreamCommit) => (
    <li key={c.sha} className="flex items-start gap-3 px-3 py-2.5">
      {c.state !== "suggest_skip" ? (
        <input
          type="checkbox"
          className="mt-1"
          checked={selected.has(c.sha)}
          onChange={() => toggle(c.sha)}
          aria-label={t("upstream.select", { sha: shortSha(c.sha) })}
        />
      ) : (
        <span className="w-[13px]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-medium text-primary">{plainSubject(c.subject)}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATE_STYLE[c.state])}>
            {stateLabel(c)}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
          <span className="font-mono">{shortSha(c.sha)}</span>
          <span>·</span>
          <span>{t(`upstream.kind.${["feat", "fix", "perf"].includes(c.kind) ? c.kind : "other"}`)}</span>
          <span>·</span>
          <span>{c.date}</span>
          {c.touches_your_files.length > 0 && c.state === "clean" ? (
            <>
              <span>·</span>
              <span title={c.touches_your_files.join("\n")}>
                {t("upstream.touchesYours", { count: c.touches_your_files.length })}
              </span>
            </>
          ) : null}
        </div>
        {c.state === "conflicts" ? (
          <div className="mt-1 break-all font-mono text-[11px] text-muted">{c.conflicts.join(", ")}</div>
        ) : null}
        {c.state === "suggest_skip" && c.hint ? <div className="mt-1 text-[12px] text-muted">{c.hint}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => void copy(skipCommand(c, t("upstream.defaultSkipReason")), t("upstream.copied"))}
          title={t("upstream.copySkip")}
          className="rounded-md px-2 py-1 text-[12px] text-muted outline-none hover:bg-surface-hover hover:text-secondary"
        >
          {t("upstream.skip")}
        </button>
        <button
          type="button"
          onClick={() => void openUrl(UPSTREAM_COMMIT_URL + c.sha).catch(() => {})}
          title={t("upstream.openCommit")}
          aria-label={t("upstream.openCommit")}
          className="rounded-md p-1.5 text-muted outline-none hover:bg-surface-hover hover:text-secondary"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );

  return (
    <div className="app-page">
      <div className="app-page-header flex items-center justify-between gap-3 pr-2">
        <div>
          <h1 className="app-page-title">{t("upstream.title")}</h1>
          <p className="app-page-subtitle">{t("upstream.subtitle")}</p>
        </div>
        {source ? (
          <button
            type="button"
            onClick={() => void check(true)}
            disabled={checking}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-[13px] text-secondary outline-none hover:bg-surface-hover disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
            {checking ? t("upstream.checking") : t("upstream.checkNow")}
          </button>
        ) : null}
      </div>

      {source === null ? (
        <section className="app-panel flex flex-col items-start gap-3 p-5">
          <GitMerge className="h-5 w-5 text-accent" />
          <div>
            <h2 className="text-[14px] font-semibold text-primary">{t("upstream.setupTitle")}</h2>
            <p className="mt-1 max-w-xl text-[13px] text-muted">{t("upstream.setupBody")}</p>
          </div>
          <button
            type="button"
            onClick={() => void chooseSource()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white outline-none hover:opacity-90"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("upstream.chooseFolder")}
          </button>
        </section>
      ) : null}

      {source ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          <span>{t("upstream.sourceLabel")}</span>
          <span className="break-all font-mono text-secondary">{source}</span>
          <button type="button" onClick={() => void chooseSource()} className="text-accent outline-none hover:underline">
            {t("upstream.change")}
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => void openUrl(UPSTREAM_REPO_URL).catch(() => {})}
            className="text-accent outline-none hover:underline"
          >
            {t("upstream.openProject")}
          </button>
        </div>
      ) : null}

      {error !== null ? (
        <StatusBanner
          tone="danger"
          title={t("upstream.checkFailed")}
          description={error || undefined}
          actionLabel={t("common.retry")}
          onAction={() => void check(true)}
        />
      ) : null}

      {checking && !report ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("upstream.checking")}
        </div>
      ) : null}

      {report && tally ? (
        <>
          {decide.length === 0 ? (
            <section className="app-panel flex items-start gap-3 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <h2 className="text-[14px] font-semibold text-primary">{t("upstream.upToDate")}</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  {t("upstream.upToDateBody", {
                    sha: shortSha(report.upstream_head.sha),
                    date: report.upstream_head.date,
                    subject: plainSubject(report.upstream_head.subject),
                  })}
                </p>
              </div>
            </section>
          ) : (
            <section className="app-panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-faint px-3 py-2.5">
                <div className="text-[13px] text-secondary">
                  {t("upstream.summary", {
                    count: decide.length,
                    clean: tally.clean + tally.after_earlier,
                    conflicts: tally.conflicts,
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={chosen.length === 0}
                    onClick={() => void copy(agentRequest(chosen), t("upstream.copied"))}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white outline-none hover:opacity-90 disabled:opacity-40"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("upstream.copyAgent", { count: chosen.length })}
                  </button>
                  <button
                    type="button"
                    disabled={chosen.length === 0}
                    onClick={() => void copy(pickCommand(chosen), t("upstream.copied"))}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-[12px] text-secondary outline-none hover:bg-surface-hover disabled:opacity-40"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("upstream.copyPick")}
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-border-faint">{decide.map(row)}</ul>
            </section>
          )}

          {skips.length > 0 ? (
            <section className="app-panel overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSkips((v) => !v)}
                aria-expanded={showSkips}
                className="w-full px-3 py-2.5 text-left text-[13px] text-secondary outline-none hover:bg-surface-hover"
              >
                {t("upstream.suggestedSkips", { count: skips.length })}
              </button>
              {showSkips ? <ul className="divide-y divide-border-faint border-t border-border-faint">{skips.map(row)}</ul> : null}
            </section>
          ) : null}

          <p className="text-[12px] text-muted">
            {t("upstream.footer", {
              skipped: report.skipped.length,
              when: new Date(report.checked_at).toLocaleString(),
            })}
          </p>
        </>
      ) : null}
    </div>
  );
}
