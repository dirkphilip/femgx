import { type PartId, type PickHit, type ViewportResultsState } from "@/entries/root";
import { scalarAt, vectorAt } from "@/entries/results";

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
    return "Click or right-click a visible element, face, node, or authored edge to inspect it.";
  }
  const context = partContext(hit.partId, partName);
  if (hit.kind === "node") {
    const adjacency =
      hit.neighborElementIds.length === 0 ? "none" : hit.neighborElementIds.join(", ");
    return withResult(
      `Node ${hit.nodeId}\n` +
        `${context} · PartOccurrence ${hit.partOccurrenceId}\n` +
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
        `Element ${hit.elementId} · ${context} · PartOccurrence ${hit.partOccurrenceId}\n` +
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
      `Element ${hit.elementId}\n${context} · PartOccurrence ${hit.partOccurrenceId}${bodyDescription(hit)}`,
      hit,
      results,
    );
  }
  if (hit.kind === "edge") {
    return describeEdgePick(hit, context);
  }
  return `PartOccurrence ${hit.partOccurrenceId}\n${context}`;
}

function describeEdgePick(
  hit: Extract<PickHit, { readonly kind: "edge" }>,
  context: string,
): string {
  const incidentElements = hit.incidentElementIds.join(", ") || "none";
  const incidentFaces = hit.faceRefs.map((ref) => `${ref.elementId}/${ref.faceIndex}`).join(", ");
  return (
    `Edge ${hit.key}\n` +
    `${context} · PartOccurrence ${hit.partOccurrenceId}\n` +
    `Authored nodes ${hit.nodeIds.join(", ")}\n` +
    `Incident elements ${incidentElements}\n` +
    `Incident faces ${incidentFaces || "none"}\n` +
    `Hit ${formatVec(hit.worldPosition)}\n` +
    `Tangent ${formatVec(hit.tangent)}`
  );
}

function withResult(
  description: string,
  hit: Exclude<PickHit, { readonly kind: "partOccurrence" }>,
  results: ViewportResultsState | undefined,
): string {
  const value = resultDescription(hit, results);
  return value === undefined ? description : `${description}\n${value}`;
}

function resultDescription(
  hit: Exclude<PickHit, { readonly kind: "partOccurrence" }>,
  results: ViewportResultsState | undefined,
): string | undefined {
  if (results === undefined) return undefined;
  const descriptions: string[] = [];
  const scalar = results.scalar?.field;
  if (scalar !== undefined) {
    const entity =
      scalar.location === "nodal"
        ? hit.kind === "node"
          ? hit.nodeId
          : undefined
        : hit.kind === "edge"
          ? undefined
          : hit.elementId;
    if (entity !== undefined && entity >= 0 && entity < scalar.count) {
      const value = scalarAt(scalar, entity);
      descriptions.push(
        `${scalar.name} (${scalar.location}, ${scalar.unit}): ${Number.isNaN(value) ? "missing" : format(value)}`,
      );
    }
  }
  const orientation = results.orientation?.field;
  if (
    orientation !== undefined &&
    orientation.shape === "vector" &&
    hit.kind !== "edge" &&
    hit.elementId !== undefined
  ) {
    const entity = hit.elementId;
    if (entity >= 0 && entity < orientation.count) {
      const value = vectorAt(orientation, entity);
      descriptions.push(
        `${orientation.name} (${orientation.location}, ${orientation.unit}): ${vectorValue(value)}`,
      );
    }
  }
  return descriptions.length === 0 ? undefined : descriptions.join("\n");
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

function vectorValue(vector: readonly [number, number, number]): string {
  if (!vector.every(Number.isFinite)) return "missing (not drawn)";
  if (vector.every((component) => component === 0)) return "zero (not drawn)";
  return `[${format(vector[0])}, ${format(vector[1])}, ${format(vector[2])}] · authored vector normalized for display · magnitude not displayed`;
}

function format(value: number): string {
  const rounded = Math.abs(value) < 1e-6 ? 0 : Number(value.toPrecision(4));
  return String(rounded);
}
