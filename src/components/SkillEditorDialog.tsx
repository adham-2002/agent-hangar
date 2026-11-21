import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FilePen, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import * as api from "../lib/tauri";
import type { ManagedSkill, SkillFinding } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import {
  draftSkillMd,
  hasUpdateSource,
  isSpecName,
  SKILL_DESCRIPTION_MAX as DESCRIPTION_MAX,
  SKILL_NAME_MAX as NAME_MAX,
  toSkillName,
} from "../lib/skillDraft";
import { SkillFindings } from "./SkillFindings";
import { SkillMarkdown } from "./SkillMarkdown";

export type SkillEditorMode = { kind: "create" } | { kind: "edit"; skill: ManagedSkill };

interface Props {
  mode: SkillEditorMode | null;
  onClose: () => void;
  /** After a save, with the skill's id. */
  onSaved: (skillId: string) => void | Promise<void>;
}

export function SkillEditorDialog({ mode, onClose, onSaved }: Props) {
  if (!mode) return null;
  const key = mode.kind === "edit" ? `edit:${mode.skill.id}` : "create";
  return <Editor key={key} mode={mode} onClose={onClose} onSaved={onSaved} />;
}

function Editor({ mode, onClose, onSaved }: { mode: SkillEditorMode } & Omit<Props, "mode">) {
  const { t } = useTranslation();
  const editing = mode.kind === "edit" ? mode.skill : null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState<string | null>(editing ? null : "");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [findings, setFindings] = useState<SkillFinding[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"write" | "preview">("write");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestRef = useRef(0);
  const editingId = editing?.id;

  // Keyed on the id, not the skill object: a library refresh hands over a new
  // object, and reloading then would throw away what the user has typed.
  useEffect(() => {
    if (!editingId) return;
    api
      .getSkillDocument(editingId)
      .then((doc) => {
        setContent(doc.content);
        setOriginal(doc.content);
      })
      .catch((e) => setLoadError(getErrorMessage(e, "")));
  }, [editingId]);

  const draft = editing ? content : draftSkillMd(name, description, body);
  const loaded = original !== null;
  const dirty = editing ? loaded && content !== original : Boolean(name || description || body);

  // Check as the user types, a beat after they stop.
  useEffect(() => {
    if (!loaded) return;
    const request = ++requestRef.current;
    setChecking(true);
    const timer = window.setTimeout(() => {
      api
        .checkSkillDraft(draft, editing?.id)
        .then((next) => {
          if (request === requestRef.current) setFindings(next);
        })
        .catch(() => {})
        .finally(() => {
          if (request === requestRef.current) setChecking(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, editing?.id, loaded]);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (confirmDiscard) setConfirmDiscard(false);
      else requestClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const nameOk = editing ? true : isSpecName(name);
  const hasErrors = findings.some((f) => f.severity === "error");
  const canSave = loaded && !saving && !checking && nameOk && !hasErrors && (editing ? dirty : true);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (editing) {
        await api.saveSkillDocument(editing.id, content);
        toast.success(t("authoring.saved", { name: editing.name }));
        await onSaved(editing.id);
      } else {
        const created = await api.createSkill(name.trim(), description.trim(), body);
        toast.success(t("authoring.created", { name: created.name }));
        await onSaved(created.skill_id);
      }
      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e, t("common.error")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={requestClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-editor-title"
        className="relative flex h-[calc(85vh/var(--app-scale))] w-full max-w-3xl flex-col rounded-xl border border-border bg-surface p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="skill-editor-title" className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-primary">
            <FilePen className="h-4 w-4 shrink-0 text-muted" />
            <span className="truncate">
              {editing ? t("authoring.editTitle", { name: editing.name }) : t("authoring.createTitle")}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <div className="app-segmented shrink-0">
              {(["write", "preview"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn("app-segmented-button", view === v && "app-segmented-button-active")}
                >
                  {t(`authoring.${v}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label={t("authoring.close")}
              className="rounded-md p-1 text-muted outline-none transition-colors hover:text-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {editing && hasUpdateSource(editing) ? (
          <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-secondary">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            {t("authoring.sourceWarning")}
          </p>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {loadError !== null ? (
            <p className="text-[13px] text-rose-600 dark:text-rose-400">{loadError || t("common.error")}</p>
          ) : !loaded ? (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : view === "preview" ? (
            <SkillMarkdown content={draft} />
          ) : editing ? (
            <textarea
              aria-label="SKILL.md"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="app-input min-h-0 w-full flex-1 resize-none font-mono text-[12px] leading-relaxed"
            />
          ) : (
            <>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary">
                {t("authoring.name")}
                <input
                  value={name}
                  onChange={(e) => setName(toSkillName(e.target.value))}
                  placeholder="sql-format"
                  maxLength={NAME_MAX}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="app-input font-mono"
                />
                <span className={cn("font-normal", name && !nameOk ? "text-rose-600 dark:text-rose-400" : "text-muted")}>
                  {t("authoring.nameHint")}
                </span>
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary">
                <span className="flex items-center justify-between">
                  {t("authoring.description")}
                  <span className="font-normal tabular-nums text-muted">
                    {description.trim().length}/{DESCRIPTION_MAX}
                  </span>
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("authoring.descriptionPlaceholder")}
                  rows={3}
                  className="app-input resize-none"
                />
                <span className="font-normal text-muted">{t("authoring.descriptionHint")}</span>
              </label>
              <label className="flex min-h-[220px] flex-1 flex-col gap-1 text-[12px] font-medium text-secondary">
                {t("authoring.instructions")}
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("authoring.instructionsPlaceholder")}
                  spellCheck={false}
                  className="app-input min-h-0 flex-1 resize-none font-mono text-[12px] leading-relaxed"
                />
              </label>
            </>
          )}
        </div>

        <div className="mt-3 border-t border-border-subtle pt-3">
          <div className="mb-3 min-h-[20px]" aria-live="polite">
            {findings.length > 0 ? (
              <SkillFindings findings={findings} className="max-h-28 overflow-y-auto" />
            ) : loaded && !checking ? (
              <p className="text-[12px] text-muted">{t("authoring.noFindings")}</p>
            ) : null}
          </div>
          {confirmDiscard ? (
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-[13px] text-secondary">{t("authoring.discardPrompt")}</span>
              <button type="button" onClick={() => setConfirmDiscard(false)} className="app-button-secondary">
                {t("authoring.keepEditing")}
              </button>
              <button type="button" onClick={onClose} className="app-button-secondary text-rose-600 dark:text-rose-400">
                {t("authoring.discard")}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              {hasErrors ? (
                <span className="mr-auto text-[12px] text-rose-600 dark:text-rose-400">{t("authoring.fixErrors")}</span>
              ) : null}
              <button type="button" onClick={requestClose} disabled={saving} className="app-button-secondary">
                {t("common.cancel")}
              </button>
              <button type="button" onClick={() => void save()} disabled={!canSave} className="app-button-primary">
                {saving ? t("common.loading") : editing ? t("authoring.save") : t("authoring.create")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
