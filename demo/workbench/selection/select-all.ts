import {
  isBodyVisible,
  isElementBlockVisible,
  isElementVisible,
  type ElementTessellation,
  type FemViewport,
  type Part,
} from "../../../src/entries/root";
import type { WorkbenchInteraction } from "../interaction/interaction";
import type { SelectionGranularity, SelectTarget } from "./pick";

const PRIMITIVE_ARITY = { triangles: 3, lines: 2, points: 1 } as const;

interface SelectAllOwner {
  readonly selectionGranularity: SelectionGranularity;
  readonly interactionController: Pick<WorkbenchInteraction, "replaceAll">;
  readonly presentation: { setFeedback(message: string): void };
  activeViewport(): FemViewport;
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
  viewport: FemViewport,
  granularity: SelectionGranularity,
): readonly SelectTarget[] {
  const targets: SelectTarget[] = [];
  for (const instanceId of viewport.runtime.getVisibleInstanceIds()) {
    const instance = viewport.runtime.getInstance(instanceId);
    const part = instance === undefined ? undefined : viewport.scene.parts.get(instance.partId);
    if (part === undefined) continue;
    const elementIds = new Set(
      visibleElements(viewport, part, instanceId).map((element) => element.id),
    );
    if (granularity === "element") {
      for (const elementId of elementIds) targets.push({ kind: "element", instanceId, elementId });
    } else if (granularity === "body") {
      appendBodies(targets, part, instanceId, elementIds);
    } else if (granularity === "block") {
      appendBlocks(targets, part, instanceId, elementIds);
    } else if (granularity === "face") {
      appendFaces(targets, part, instanceId, elementIds);
    } else if (granularity === "node") {
      appendNodes(targets, part, instanceId, elementIds);
    } else {
      appendEdges(targets, part, instanceId, elementIds);
    }
  }
  return targets;
}

function appendBodies(
  targets: SelectTarget[],
  part: Part,
  instanceId: string,
  elementIds: ReadonlySet<number>,
): void {
  for (const body of part.bodies ?? []) {
    if (body.elementIds.some((elementId) => elementIds.has(elementId))) {
      targets.push({ kind: "body", instanceId, bodyId: body.id });
    }
  }
}

function appendBlocks(
  targets: SelectTarget[],
  part: Part,
  instanceId: string,
  elementIds: ReadonlySet<number>,
): void {
  for (const block of part.blocks ?? []) {
    if (block.elementIds.some((elementId) => elementIds.has(elementId))) {
      targets.push({ kind: "block", instanceId, blockId: block.id });
    }
  }
}

function visibleElements(
  viewport: FemViewport,
  part: Part,
  instanceId: string,
): readonly ElementTessellation[] {
  const bodyByElement = new Map(
    part.bodies?.flatMap((body) => body.elementIds.map((id) => [id, body.id] as const)),
  );
  const blockByElement = new Map(
    part.blocks?.flatMap((block) => block.elementIds.map((id) => [id, block.id] as const)),
  );
  return (part.elements ?? []).filter((element) => {
    if (!isElementVisible(viewport.interaction, { instanceId, elementId: element.id }))
      return false;
    const bodyId = element.bodyId ?? bodyByElement.get(element.id);
    if (bodyId !== undefined && !isBodyVisible(viewport.interaction, { instanceId, bodyId })) {
      return false;
    }
    const blockId = element.blockId ?? blockByElement.get(element.id);
    return (
      blockId === undefined || isElementBlockVisible(viewport.interaction, { instanceId, blockId })
    );
  });
}

function appendFaces(
  targets: SelectTarget[],
  part: Part,
  instanceId: string,
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
      instanceId,
      elementId: face.elementId,
      faceIndex: face.faceIndex,
    });
  }
}

function appendNodes(
  targets: SelectTarget[],
  part: Part,
  instanceId: string,
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
    targets.push({ kind: "node", instanceId, nodeId });
  }
}

function appendEdges(
  targets: SelectTarget[],
  part: Part,
  instanceId: string,
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
    targets.push({ kind: "edge", instanceId, key: edge.key });
  }
}
