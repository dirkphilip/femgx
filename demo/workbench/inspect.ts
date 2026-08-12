import type { PartId, PickHit } from "../../src/index";

/**
 * Optional resolver for a part's display name, so the inspection panel can
 * identify the assembly/part context (e.g. "Steel plates") instead of only a
 * numeric part id.
 */
export type PartNameResolver = (partId: number) => string | undefined;

/** Formats a GPU pick target for the inspection panel. */
export function describePick(
  hit: PickHit | undefined,
  partName: PartNameResolver = () => undefined,
): string {
  if (hit === undefined) {
    return "Click or right-click a visible element, face, or node to inspect it.";
  }
  const context = partContext(hit.partId, partName);
  if (hit.kind === "node") {
    const adjacency =
      hit.neighborElementIds.length === 0 ? "none" : hit.neighborElementIds.join(", ");
    return (
      `Node ${hit.nodeId}\n` +
      `${context} · Instance ${hit.instanceId}\n` +
      bodyDescription(hit) +
      (hit.bodyId === undefined ? "" : "\n") +
      `Position ${formatVec(hit.worldPosition)}\n` +
      `Adjacent elements ${adjacency}\n` +
      `Neighbors ${hit.neighborNodeIds.length}`
    );
  }
  if (hit.kind === "face") {
    const owners = hit.neighborElementIds.join(", ");
    return (
      `Face ${hit.key}\n` +
      `Element ${hit.elementId} · ${context} · Instance ${hit.instanceId}\n` +
      bodyDescription(hit) +
      (hit.bodyId === undefined ? "" : "\n") +
      `Normal ${formatVec(hit.normal)}\n` +
      `Hit ${formatVec(hit.worldPosition)}\n` +
      `Adjacent elements ${owners || "none"}\n` +
      `Vertices ${hit.nodeIds.length}`
    );
  }
  if (hit.kind === "element") {
    return `Element ${hit.elementId}\n${context} · Instance ${hit.instanceId}${bodyDescription(hit)}`;
  }
  return `Instance ${hit.instanceId}\n${context}`;
}

function bodyDescription(hit: { readonly bodyId?: number }): string {
  return hit.bodyId === undefined ? "" : `\nBody ${hit.bodyId}`;
}

/** "Part N · Name" when a name is known, otherwise just "Part N". */
function partContext(partId: PartId, partName: PartNameResolver): string {
  const name = partName(partId);
  return name === undefined ? `Part ${partId}` : `Part ${partId} · ${name}`;
}

function formatVec(vector: readonly [number, number, number]): string {
  return `(${format(vector[0])}, ${format(vector[1])}, ${format(vector[2])})`;
}

function format(value: number): string {
  const rounded = Math.abs(value) < 1e-6 ? 0 : Number(value.toPrecision(4));
  return String(rounded);
}
