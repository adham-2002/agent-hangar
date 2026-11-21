import type { CatalogEntry } from "./tauri";

/** How many results Browse shows at once; the catalog runs to thousands. */
export const CATALOG_PAGE = 60;

/**
 * Catalog search: every word of the query must appear in the name, the
 * marketplace or the description. Name matches rank first, then the most
 * installed, so the plugin people mean usually leads.
 */
export function searchCatalog(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const installs = (e: CatalogEntry) => e.install_count ?? 0;
  const matched = words.length === 0
    ? [...entries]
    : entries.filter((e) => {
        const haystack = `${e.name} ${e.marketplace} ${e.description ?? ""}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      });
  const nameHit = (e: CatalogEntry) =>
    words.length > 0 && words.every((w) => e.name.toLowerCase().includes(w)) ? 0 : 1;
  return matched.sort(
    (a, b) => nameHit(a) - nameHit(b) || installs(b) - installs(a) || a.name.localeCompare(b.name)
  );
}
