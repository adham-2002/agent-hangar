/**
 * Squarified treemap (Bruls, Huizing, van Wijk): lays items out as
 * rectangles whose areas are proportional to their values, keeping each
 * rectangle as close to square as it can so labels stay readable.
 */

export interface TreemapRect<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The worst aspect ratio in a row laid along a side of length `side`. */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((n, a) => n + a, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

export function treemap<T>(items: T[], value: (item: T) => number, width: number, height: number): TreemapRect<T>[] {
  const entries = items
    .map((item) => ({ item, value: value(item) }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = entries.reduce((n, e) => n + e.value, 0);
  if (total === 0 || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const out: TreemapRect<T>[] = [];
  const box: Box = { x: 0, y: 0, w: width, h: height };

  const place = (row: { item: T; area: number }[]) => {
    const sum = row.reduce((n, r) => n + r.area, 0);
    if (box.w >= box.h) {
      // A column down the left of the remaining box.
      const colW = sum / box.h;
      let y = box.y;
      for (const r of row) {
        const h = r.area / colW;
        out.push({ item: r.item, x: box.x, y, w: colW, h });
        y += h;
      }
      box.x += colW;
      box.w -= colW;
    } else {
      // A row across the top of the remaining box.
      const rowH = sum / box.w;
      let x = box.x;
      for (const r of row) {
        const w = r.area / rowH;
        out.push({ item: r.item, x, y: box.y, w, h: rowH });
        x += w;
      }
      box.y += rowH;
      box.h -= rowH;
    }
  };

  let row: { item: T; area: number }[] = [];
  for (const e of entries) {
    const area = e.value * scale;
    const side = Math.min(box.w, box.h);
    const current = row.map((r) => r.area);
    if (row.length === 0 || worst([...current, area], side) <= worst(current, side)) {
      row.push({ item: e.item, area });
    } else {
      place(row);
      row = [{ item: e.item, area }];
    }
  }
  if (row.length) place(row);
  return out;
}
