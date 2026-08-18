/** Six tets per hex cell, matching the existing structured-grid split. */
const TETS_PER_CELL = 6;

/** Default cubic size for responsive on-demand demo meshing. */
export const TET4_DENSE_DEFAULT_CELLS = 16;
/** Upper bound for canonical worker reconstruction in the interactive demo. */
export const TET4_DENSE_MAX_CELLS = 50;

/** Authored Tet4 count for a structured hex grid split into six tets per cell. */
export function tet4ElementCount(cellsX: number, cellsY: number, cellsZ: number): number {
  return cellsX * cellsY * cellsZ * TETS_PER_CELL;
}

/** Parses a cell-count string; invalid values are ignored. */
export function parseTet4Cells(raw: string): number | undefined {
  const cells = Number(raw);
  if (!Number.isInteger(cells) || cells < 1 || cells > TET4_DENSE_MAX_CELLS) return undefined;
  return cells;
}

/** Reads `?tet4=<cells>` from a query string. */
export function parseTet4CellsQuery(search: string): number | undefined {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return parseTet4Cells(new URLSearchParams(query).get("tet4") ?? "");
}
