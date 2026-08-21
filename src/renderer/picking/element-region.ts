import {
  createElementRegionSelection,
  type ElementRegionSelection,
} from "../../interaction/element-region-selection";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { PickContext } from "../../picking/pick";
import { resolvePick } from "../../picking/pick";
import { decodePickId } from "./pick-format";
import type { PickRegionProbe } from "./region-probe";

export type ElementPickGroups = Map<number, Set<number>>;

/** Decodes one two-attachment tile directly into numeric primitive identities. */
export function decodeElementRegion(
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
  target: { readonly groups: ElementPickGroups; readonly probe: PickRegionProbe | undefined },
): void {
  const elementOffset = bytesPerRow * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = bytesPerRow * y + x * 4;
      const instancePickId = decodePickId(bytes, offset);
      const elementPickId = decodePickId(bytes, elementOffset + offset);
      if (instancePickId === 0 || elementPickId === 0) continue;
      recordElementPick(target, instancePickId, elementPickId);
    }
  }
}

/** Resolves grouped primitive ids once per occurrence into stable packed CSR columns. */
export function resolveElementRegion(
  picks: ElementPickGroups,
  context: PickContext,
): ElementRegionSelection {
  const groups = new Map<string, Set<number>>();
  for (const [instancePickId, elementPickIds] of picks) {
    const instance = resolvePick(context.instances, instancePickId - 1);
    const part = instance === undefined ? undefined : context.parts.get(instance.partId);
    if (instance === undefined || part === undefined) continue;
    const semantic = getPartSemanticIndex(part);
    const values = new Set<number>();
    for (const elementPickId of elementPickIds) {
      const elementId = elementPickId - 1;
      if (semantic.hasElement(elementId)) values.add(elementId);
    }
    if (values.size > 0) groups.set(instance.partOccurrenceId, values);
  }
  return createElementRegionSelection(groups);
}

function recordElementPick(
  target: { readonly groups: ElementPickGroups; readonly probe: PickRegionProbe | undefined },
  instancePickId: number,
  elementPickId: number,
): void {
  let ids = target.groups.get(instancePickId);
  if (ids === undefined) {
    ids = new Set();
    target.groups.set(instancePickId, ids);
    if (target.probe !== undefined) target.probe.elementPickGroups += 1;
  }
  const previousSize = ids.size;
  ids.add(elementPickId);
  if (target.probe !== undefined && ids.size !== previousSize) target.probe.elementPickIds += 1;
}
