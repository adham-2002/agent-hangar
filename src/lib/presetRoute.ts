/**
 * Library and a preset are the same page: `/my-skills` is the whole library,
 * `/my-skills?preset=<id>` is that preset. The preset lives in the URL so
 * opening Library never silently lands inside whichever preset was viewed last.
 */
export const LIBRARY_PATH = "/my-skills";

export function presetPath(id: string): string {
  return `${LIBRARY_PATH}?preset=${encodeURIComponent(id)}`;
}

/** The preset a location shows, or `null` for the plain library or any other page. */
export function presetIdFromLocation(location: { pathname: string; search: string }): string | null {
  if (location.pathname !== LIBRARY_PATH) return null;
  return new URLSearchParams(location.search).get("preset") || null;
}
