import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { DetailSheet } from "./DetailSheet";
import { SkillMarkdown } from "./SkillMarkdown";

export interface PluginSkillTarget {
  installPath: string;
  skill: string;
  pluginName: string;
}

interface Props {
  /** The plugin's folder and one of its bundled skills, or null when closed. */
  target: PluginSkillTarget | null;
  onClose: () => void;
}

/** Read one skill a plugin bundles. Read-only: Claude Code manages it. */
export function PluginSkillSheet({ target, onClose }: Props) {
  const { t } = useTranslation();
  // The result remembers which skill it is for, so switching skills shows the
  // spinner at once and a late answer for the previous one is never shown.
  const [loaded, setLoaded] = useState<
    { for: PluginSkillTarget; content: string | null; error: string | null } | null
  >(null);

  useEffect(() => {
    if (!target) return;
    let live = true;
    api
      .getPluginSkillDocument(target.installPath, target.skill)
      .then((doc) => {
        if (live) setLoaded({ for: target, content: doc.content, error: null });
      })
      .catch((e) => {
        // Translated at render, so the effect does not depend on `t`: a new
        // `t` must not refetch the document.
        if (live) setLoaded({ for: target, content: null, error: getErrorMessage(e, "") });
      });
    return () => {
      live = false;
    };
  }, [target]);

  const current = loaded && loaded.for === target ? loaded : null;
  const content = current?.content ?? null;
  const error = current ? (current.error === "" ? t("common.error") : current.error) : null;

  return (
    <DetailSheet
      open={target !== null}
      title={target?.skill ?? ""}
      meta={
        target ? (
          <p className="text-[12px] text-muted">
            {t("plugins.skillSheet.from", { plugin: target.pluginName })}
          </p>
        ) : null
      }
      onClose={onClose}
    >
      {error ? (
        <p className="text-[13px] text-muted">{error}</p>
      ) : content === null ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : (
        <SkillMarkdown content={content} />
      )}
    </DetailSheet>
  );
}
