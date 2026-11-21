import { AlertCircle, AlertTriangle, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import type { FindingSeverity, SkillFinding } from "../lib/tauri";

const ICONS: Record<FindingSeverity, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Lightbulb,
};

const TONES: Record<FindingSeverity, string> = {
  error: "text-rose-600 dark:text-rose-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-muted",
};

/** Quality findings, worst first, in the user's language. */
export function SkillFindings({ findings, className }: { findings: SkillFinding[]; className?: string }) {
  const { t } = useTranslation();
  if (findings.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {findings.map((finding, i) => {
        const Icon = ICONS[finding.severity];
        return (
          <li key={`${finding.code}-${i}`} className="flex items-start gap-1.5 text-[12px] text-secondary">
            <Icon aria-hidden className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", TONES[finding.severity])} />
            <span className="sr-only">{t(`quality.severity.${finding.severity}`)}: </span>
            <span>{t(`quality.codes.${finding.code}`, { ...finding.params, defaultValue: finding.message })}</span>
          </li>
        );
      })}
    </ul>
  );
}
