import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Gauge, Swords } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../lib/tauri";
import type { PresetSummary } from "../lib/tauri";
import { formatTokens } from "../lib/insights";

interface Props {
  presetId: string;
  /** Changes whenever the preset's skills change, so the summary is redone. */
  memberKey: string;
}

/** One line under a preset's title: what it costs and whether its skills clash. */
export function PresetBudgetStrip({ presetId, memberKey }: Props) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<{ key: string; value: PresetSummary } | null>(null);
  const key = `${presetId}|${memberKey}`;

  useEffect(() => {
    let live = true;
    api
      .getPresetSummary(presetId)
      .then((value) => {
        if (live) setSummary({ key: `${presetId}|${memberKey}`, value });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [presetId, memberKey]);

  const value = summary?.key === key ? summary.value : null;
  if (!value || value.skills === 0) return null;

  return (
    <p className="-mt-1 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 pr-2 text-[12px] text-muted">
      <span className="flex items-center gap-1">
        <Gauge className="h-3.5 w-3.5" />
        {t("insights.presets.strip", { tokens: formatTokens(value.always_on) })}
      </span>
      {value.clashes > 0 ? (
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <Swords className="h-3.5 w-3.5" />
          {t("insights.presets.clashes", { count: value.clashes })}
        </span>
      ) : null}
      {value.problems > 0 ? (
        <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t("insights.presets.problems", { count: value.problems })}
        </span>
      ) : null}
      <Link to="/insights" className="font-medium text-accent-light hover:underline">
        {t("insights.presets.details")}
      </Link>
    </p>
  );
}
