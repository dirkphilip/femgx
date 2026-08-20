import type { ElementTopology } from "./shapes";

/** Returns the canonical topology edge joining two local node positions. */
export function edgeIndexOf(topology: ElementTopology, first: number, last: number): number {
  for (let index = 0; index < topology.edges.length; index += 1) {
    const edge = topology.edges[index];
    if (
      edge !== undefined &&
      ((edge[0] === first && edge[1] === last) || (edge[0] === last && edge[1] === first))
    ) {
      return index;
    }
  }
  throw new Error(`Face edge ${first}-${last} is not a topology edge`);
}

/** Sorts one small range in a typed integer column. */
export function sortUint32Range(values: Uint32Array, start: number, count: number): void {
  for (let index = start + 1; index < start + count; index += 1) {
    const value = values[index] ?? 0;
    let cursor = index;
    while (cursor > start && (values[cursor - 1] ?? 0) > value) {
      values[cursor] = values[cursor - 1] ?? 0;
      cursor -= 1;
    }
    values[cursor] = value;
  }
}
