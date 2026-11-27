import type { TFunction } from "i18next";
import { channelLabel } from "./skillChannels";
import type { SkillSourceCandidate } from "./skillSource";
import { UNTAGGED_FILTER } from "./skillTags";

export interface FilterChip {
  kind: "channel" | "source" | "tag";
  value: string;
  label: string;
}

/** The active Library filters, one removable chip each, in the order they are set up. */
export function activeFilterChips(input: {
  channels: ReadonlySet<string>;
  sources: ReadonlySet<string>;
  tags: ReadonlySet<string>;
  sourceOptions: SkillSourceCandidate[];
  t: TFunction;
}): FilterChip[] {
  const sourceLabel = new Map(input.sourceOptions.map((s) => [s.key, s.label]));
  return [
    ...[...input.channels].map((value) => ({
      kind: "channel" as const,
      value,
      label: channelLabel(input.t, value),
    })),
    ...[...input.sources].map((value) => ({
      kind: "source" as const,
      value,
      label: sourceLabel.get(value) || value,
    })),
    ...[...input.tags].map((value) => ({
      kind: "tag" as const,
      value,
      label: value === UNTAGGED_FILTER ? input.t("mySkills.tags.untagged") : value,
    })),
  ];
}
