/**
 * A stable colour per skill source, so a skill's pack is recognisable at a
 * glance in any view, grouped or not.
 *
 * Colours come from a fixed palette of 500 shades, which read on both the light
 * and the dark background. A colour is never the only signal: the source name
 * is always shown next to it (group header, tooltip), so a colour-blind reader
 * and two sources that share a hue both stay unambiguous.
 */

/** Full class names, so Tailwind's scanner keeps every one of them. */
export const SOURCE_PALETTE = [
  "bg-sky-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-fuchsia-500",
  "bg-lime-500",
  "bg-indigo-500",
] as const;

export type SourceColorClass = (typeof SOURCE_PALETTE)[number];

/** FNV-1a: small, fast and stable across sessions and machines. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Give each source key a palette colour.
 *
 * Each key starts at the slot its hash picks, so a source keeps its colour from
 * one launch to the next. When that slot is taken it moves to the next free
 * one, so the first ten sources never share a colour. Keys are placed in sorted
 * order, which makes the result independent of the order they arrive in. Past
 * ten sources colours repeat, which is why the name always travels with it.
 * The `unknown` bucket is not a source and gets no colour.
 */
export function assignSourceColors(keys: Iterable<string>): Map<string, SourceColorClass> {
  const unique = [...new Set(keys)].filter((key) => key !== "unknown").sort();
  const size = SOURCE_PALETTE.length;
  const used = new Set<number>();
  const out = new Map<string, SourceColorClass>();

  for (const key of unique) {
    let slot = hash(key) % size;
    if (used.size < size) {
      while (used.has(slot)) slot = (slot + 1) % size;
    }
    used.add(slot);
    out.set(key, SOURCE_PALETTE[slot]);
  }
  return out;
}
