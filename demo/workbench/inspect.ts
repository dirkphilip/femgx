import { scalarAt, type PartId, type PickHit, type ViewportResultsState } from "../../src/index";

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
  results?: ViewportResultsState,
): string {
  if (hit === undefined) {
    return "Click or right-click a visible element, face, or node to inspect it.";
  }
  const context = partContext(hit.partId, partName);
  if (hit.kind === "node") {
    const adjacency =
      hit.neighborElementIds.length === 0 ? "none" : hit.neighborElementIds.join(", ");
    return withResult(
      `Node ${hit.nodeId}\n` +
        `${context} · Instance ${hit.instanceId}\n` +
        bodyDescription(hit) +
        (hit.bodyId === undefined ? "" : "\n") +
        `Position ${formatVec(hit.worldPosition)}\n` +
        `Adjacent elements ${adjacency}\n` +
        `Neighbors ${hit.neighborNodeIds.length}`,
      hit,
      results,
    );
  }
  if (hit.kind === "face") {
    const owners = hit.neighborElementIds.join(", ");
    return withResult(
      `Face ${hit.key}\n` +
        `Element ${hit.elementId} · ${context} · Instance ${hit.instanceId}\n` +
        bodyDescription(hit) +
        (hit.bodyId === undefined ? "" : "\n") +
        `Normal ${formatVec(hit.normal)}\n` +
        `Hit ${formatVec(hit.worldPosition)}\n` +
        `Adjacent elements ${owners || "none"}\n` +
        `Vertices ${hit.nodeIds.length}`,
      hit,
      results,
    );
  }
  if (hit.kind === "element") {
    return withResult(
      `Element ${hit.elementId}\n${context} · Instance ${hit.instanceId}${bodyDescription(hit)}`,
      hit,
      results,
    );
  }
  return `Instance ${hit.instanceId}\n${context}`;
}

function withResult(
  description: string,
  hit: Exclude<PickHit, { readonly kind: "instance" }>,
  results: ViewportResultsState | undefined,
): string {
  const value = resultDescription(hit, results);
  return value === undefined ? description : `${description}\n${value}`;
}

function resultDescription(
  hit: Exclude<PickHit, { readonly kind: "instance" }>,
  results: ViewportResultsState | undefined,
): string | undefined {
  if (results === undefined) return undefined;
  const field = results.scalar?.field;
  if (field === undefined) return undefined;
  const entity =
    field.location === "nodal" ? (hit.kind === "node" ? hit.nodeId : undefined) : hit.elementId;
  if (entity === undefined || entity < 0 || entity >= field.count) return undefined;
  const value = scalarAt(field, entity);
  return `${field.name} (${field.location}, ${field.unit}): ${Number.isNaN(value) ? "missing" : format(value)}`;
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
