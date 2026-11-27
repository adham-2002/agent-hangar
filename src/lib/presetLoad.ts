/**
 * How heavy a preset is in an agent's context, from the tokens its skills add
 * to every session. Each skill's name-and-description listing costs ~30-100
 * tokens, so these bands are roughly "a focused set", "a broad set" and "most
 * of a library".
 */
export type PresetLoad = "light" | "medium" | "heavy";

export const MEDIUM_FROM_TOKENS = 1_500;
export const HEAVY_FROM_TOKENS = 4_000;

export function presetLoad(alwaysOnTokens: number): PresetLoad {
  if (alwaysOnTokens >= HEAVY_FROM_TOKENS) return "heavy";
  if (alwaysOnTokens >= MEDIUM_FROM_TOKENS) return "medium";
  return "light";
}
