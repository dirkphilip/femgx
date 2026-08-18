import { type ElementTessellation, type Viewport, type Part } from "../../../src/entries/root";
import { isBodyVisible, isElementVisible } from "../../../src/entries/interaction";
import type { WorkbenchInteraction } from "../interaction/interaction";
import type { SelectionGranularity, SelectTarget } from "./pick";

const PRIMITIVE_ARITY = { triangles: 3, lines: 2, points: 1 } as const;

interface SelectAllOwner {
  readonly selectionGranularity: SelectionGranularity;
  readonly interactionController: Pick<WorkbenchInteraction, "replaceAll">;
  readonly presentation: { setFeedback(message: string): void };
  activeViewport(): Viewport;
}

/** Replaces the current selection with every eligible target. */
export function selectAll(owner: SelectAllOwner): void {
  const granularity = owner.selectionGranularity;
  const targets = selectAllTargets(owner.activeViewport(), granularity);
  owner.interactionController.replaceAll(targets);
  const noun = granularity === "element" ? "element" : granularity;
  owner.presentation.setFeedback(
    `Selected all ${targets.length} visible ${noun}${targets.length === 1 ? "" : "s"}.`,
  );
}

/** Collects every explicitly visible target at the active workbench granularity. */
export function selectAllTargets(
  viewport: Viewport,
  granularity: SelectionGranularity,
): readonly SelectTarget[] {
  const targets: SelectTarget[] = [];
  const selectedPartIds = new Set<number>();
  for (const partOccurrenceId of viewport.runtime.getVisiblePartOccurrenceIds()) {
    const instance = viewport.runtime.getPartOccurrence(partOccurrenceId);
    const part = instance === undefined ? undefined : viewport.scene.parts.get(instance.partId);
    if (part === undefined) continue;
    if (granularity === "part") {
      if (selectedPartIds.has(part.id)) continue;
      selectedPartIds.add(part.id);
      targets.push({ kind: "part", partId: part.id });
      continue;
    }
    if (granularity === "partOccurrence") {
      targets.push({ kind: "partOccurrence", partOccurrenceId });
      continue;
    }
    const elementIds = new Set(
      visibleElements(viewport, part, partOccurrenceId).map((element) => element.id),
    );
    if (granularity === "element") {
      for (const elementId of elementIds)
        targets.push({ kind: "element", partOccurrenceId, elementId });
    } else if (granularity === "body") {
      appendBodies(targets, part, partOccurrenceId, elementIds);
    } else if (granularity === "face") {
      appendFaces(targets, part, partOccurrenceId, elementIds);
    } else if (granularity === "node") {
      appendNodes(targets, part, partOccurrenceId, elementIds);
    } else {
      appendEdges(targets, part, partOccurrenceId, elementIds);
    }
  }
  return targets;
}

function appendBodies(
  targets: SelectTarget[],
  part: Part,
  partOccurrenceId: string,
  elementIds: ReadonlySet<number>,
): void {
  for (const body of part.bodies ?? []) {
    if (body.elementIds.some((elementId) => elementIds.has(elementId))) {
      targets.push({ kind: "body", partOccurrenceId, bodyId: body.id });
    }
  }
}

function visibleElements(
  viewport: Viewport,
  part: Part,
  partOccurrenceId: string,
): readonly ElementTessellation[] {
  const bodyByElement = new Map(
    part.bodies?.flatMap((body) => body.elementIds.map((id) => [id, body.id] as const)),
  );
  return (part.elements ?? []).filter((element) => {
    if (!isElementVisible(viewport.interaction.state, { partOccurrenceId, elementId: element.id }))
      return false;
    const bodyId = element.bodyId ?? bodyByElement.get(element.id);
    if (
      bodyId !== undefined &&
      !isBodyVisible(viewport.interaction.state, { partOccurrenceId, bodyId })
    ) {
      return false;
    }
    return true;
  });
}

function appendFaces(
  targets: SelectTarget[],
  part: Part,
  partOccurrenceId: string,
  elementIds: ReadonlySet<number>,
): void {
  const geometry = part.geometries.find((candidate) => candidate.primitive === "triangles");
  if (geometry?.primitive !== "triangles") return;
  const included =
    geometry.faceSubset === undefined
      ? undefined
      : new Set(geometry.faceSubset.faceIds.map((face) => `${face.elementId}:${face.faceIndex}`));
  for (const face of geometry.faces ?? []) {
    if (!elementIds.has(face.elementId)) continue;
    if (included !== undefined && !included.has(`${face.elementId}:${face.faceIndex}`)) continue;
    targets.push({
      kind: "face",
      partOccurrenceId,
      elementId: face.elementId,
      faceIndex: face.faceIndex,
    });
  }
}

function appendNodes(
  targets: SelectTarget[],
  part: Part,
  partOccurrenceId: string,
  elementIds: ReadonlySet<number>,
): void {
  const nodeIds = new Set<number>();
  const elements = part.elements ?? [];
  for (const geometry of part.geometries) {
    const ranges =
      elements.length === 0
        ? [{ primitiveStart: 0, primitiveCount: geometry.indices.length }]
        : elements
            .filter((element) => elementIds.has(element.id))
            .flatMap((element) =>
              element.primitiveRanges.filter((range) => range.primitive === geometry.primitive),
            );
    const arity = PRIMITIVE_ARITY[geometry.primitive];
    for (const range of ranges) {
      const start = range.primitiveStart * arity;
      const end =
        elements.length === 0 ? range.primitiveCount : start + range.primitiveCount * arity;
      for (let offset = start; offset < end; offset++) {
        const vertex = geometry.indices[offset];
        const pickId = vertex === undefined ? undefined : geometry.nodePickIds?.[vertex];
        if (pickId !== undefined && pickId > 0) nodeIds.add(pickId - 1);
      }
    }
  }
  for (const nodeId of [...nodeIds].sort((left, right) => left - right)) {
    targets.push({ kind: "node", partOccurrenceId, nodeId });
  }
}

function appendEdges(
  targets: SelectTarget[],
  part: Part,
  partOccurrenceId: string,
  elementIds: ReadonlySet<number>,
): void {
  const seen = new Set<string>();
  const hasElements = (part.elements?.length ?? 0) > 0;
  for (const edge of part.geometries.flatMap((geometry) => geometry.edges ?? [])) {
    if (seen.has(edge.key)) continue;
    if (
      hasElements &&
      edge.incidentElementIds.length > 0 &&
      !edge.incidentElementIds.some((elementId) => elementIds.has(elementId))
    ) {
      continue;
    }
    seen.add(edge.key);
    targets.push({ kind: "edge", partOccurrenceId, key: edge.key });
  }
}
