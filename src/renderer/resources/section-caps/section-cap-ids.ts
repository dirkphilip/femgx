import type { Part, PartId } from "../../../geometry/part";

/** Allocates one private cap id with direct checks instead of source-map traversal. */
export function nextSectionCapId(
  parts: ReadonlyMap<PartId, Part>,
  caps: ReadonlyMap<PartId, Part>,
  initial: PartId,
): { readonly id: PartId; readonly nextId: PartId } {
  let id = initial;
  while (parts.has(id) || caps.has(id)) {
    id -= 1;
    if (id < 0) throw new Error("Section-cap part identityMatrix capacity exhausted");
  }
  return { id, nextId: id - 1 };
}

/** Stable source occurrence/element identity for cap reuse. */
export function sectionCapKey(sourcePartId: PartId, slot: number, elementId: number): string {
  return `${sourcePartId}/${slot}/${elementId}`;
}
