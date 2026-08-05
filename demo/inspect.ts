import type { ResolvedPick } from "../src/index";

/**
 * Optional resolver for a part's display name, so the inspection panel can
 * identify the assembly/part context (e.g. "Steel plates") instead of only a
 * numeric part id.
 */
export type PartNameResolver = (partId: number) => string | undefined;

/** Formats the world-space hit data of a resolved pick for the inspection panel. */
export function describePick(
  hit: ResolvedPick | undefined,
  partName: PartNameResolver = () => undefined,
): string {
  if (hit === undefined) {
    return "Click or right-click a visible element, face, or node to inspect it.";
  }
  const context = partContext(hit.partId, partName);
  const position = formatVec(hit.position);
  if (hit.kind === "node") {
    const adjacency =
      hit.adjacentElementIds.length === 0 ? "none" : hit.adjacentElementIds.join(", ");
    return (
      `Node ${hit.nodeId}\n` +
      `${context} Instance ${hit.instanceId}\n` +
      `Position ${position}\n` +
      `Adjacent elements ${adjacency}\n` +
      `Neighbors ${hit.adjacentNodeIds.length}`
    );
  }
  if (hit.kind === "face") {
    const owners = hit.adjacentElementIds.join(", ");
    return (
      `Face ${hit.faceKey}\n` +
      `Element ${hit.elementId} · ${context} Instance ${hit.instanceId}\n` +
      `Normal ${formatVec(hit.normal)}\n` +
      `Hit ${position}\n` +
      `${hit.boundary ? "Boundary" : "Interior"} · Adjacent elements ${owners}\n` +
      `Vertices ${hit.vertices.length}`
    );
  }
  return (
    `Element ${hit.elementId}\n` +
    `${context} Instance ${hit.instanceId}\n` +
    `Normal ${formatVec(hit.normal)}\n` +
    `Hit ${position}`
  );
}

/** "Part N · Name" when a name is known, otherwise just "Part N". */
function partContext(partId: number, partName: PartNameResolver): string {
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
