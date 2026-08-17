import type { Part } from "../../src/geometry/part";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import { identity } from "../../src/math/mat4";
import { resolvePickHit, type PickContext, type ResolvedPickIds } from "../../src/picking/pick";
import { buildFaceSubsetIndices } from "../../src/renderer/selection/face-subset";
import {
  buildElementPrimitivePickIds,
  buildFacePrimitivePickIds,
} from "../../src/renderer/picking/ids";
import { expandSurfaceGeometry } from "../../src/renderer/resources/surface-geometry";
import type { OperationSpec } from "./operation-report";

interface PickBenchmarkInput {
  readonly part: Part;
  readonly instanceId: string;
}

interface PickBenchmarkSetup {
  readonly context: PickContext;
  readonly directIds: ResolvedPickIds;
  readonly physicalIds: ResolvedPickIds;
  readonly expectedElementId: number;
  readonly expectedNodeId: number;
  readonly baseWorkloadDetails: Readonly<Record<string, number>>;
}

/** Adds direct and controller-like deepest-hit operations for the Tet4 fixture. */
export function pickResolutionOperations(input: PickBenchmarkInput): readonly OperationSpec[] {
  const setup = buildPickBenchmarkSetup(input);
  return [
    {
      name: "pick-direct-element-near-last-authored",
      workloadUnit: "resolved element hits per invocation",
      workloadCount: 1,
      workloadDetails: {
        ...setup.baseWorkloadDetails,
        elementPickId: setup.directIds.elementPickId,
        facePickId: 0,
        nodePickId: 0,
        adjacencyResolved: 0,
      },
      run: () => {
        assertDirectElementHit(setup);
      },
    },
    {
      name: "pick-deepest-triangle-near-last-ids",
      workloadUnit: "resolved deepest triangle hits per invocation",
      workloadCount: 1,
      workloadDetails: {
        ...setup.baseWorkloadDetails,
        elementPickId: setup.physicalIds.elementPickId,
        facePickId: setup.physicalIds.facePickId,
        nodePickId: setup.physicalIds.nodePickId,
        adjacencyResolved: 1,
      },
      run: () => {
        assertDeepestTriangleHit(setup);
      },
    },
  ];
}

function buildPickBenchmarkSetup(input: PickBenchmarkInput): PickBenchmarkSetup {
  // RendererAttachment.prepareParts() primes this immutable lookup before a
  // pick/readback. Keep the baseline's setup faithful without charging the
  // first-call index construction to hit resolution.
  const semanticIndexStart = performance.now();
  const semantic = getPartSemanticIndex(input.part);
  const semanticIndexSetupMs = performance.now() - semanticIndexStart;
  const elements = input.part.elements ?? [];
  const triangles = input.part.geometries.find((geometry) => geometry.primitive === "triangles");
  const lastElement = elements.at(-1);
  if (triangles?.primitive !== "triangles" || lastElement === undefined) {
    throw new Error("Pick operation fixture is missing Tet4 triangle metadata");
  }
  const facePickIds = buildFacePrimitivePickIds(triangles);
  const elementPickIds = buildElementPrimitivePickIds(triangles, elements);
  const subsetIndices =
    triangles.faceSubset === undefined ? triangles.indices : buildFaceSubsetIndices(triangles);
  const rendered = expandSurfaceGeometry(triangles, subsetIndices);
  const lastVertex = rendered.nodePickIds.length - 1;
  const primitiveIndex = rendered.primitiveIds[lastVertex];
  const physicalElementPickId =
    primitiveIndex === undefined ? 0 : (elementPickIds[primitiveIndex] ?? 0);
  const physicalFacePickId = primitiveIndex === undefined ? 0 : (facePickIds[primitiveIndex] ?? 0);
  const physicalNodePickId = rendered.nodePickIds[lastVertex] ?? 0;
  if (physicalElementPickId === 0 || physicalFacePickId === 0 || physicalNodePickId === 0) {
    throw new Error("Pick operation fixture has no complete final rendered triangle ids");
  }
  const context: PickContext = {
    instances: [
      { instanceId: input.instanceId, partId: input.part.id, worldTransform: identity() },
    ],
    parts: new Map([[input.part.id, input.part]]),
  };
  return {
    context,
    directIds: {
      instancePickId: 1,
      elementPickId: lastElement.id + 1,
      facePickId: 0,
      nodePickId: 0,
    },
    physicalIds: {
      instancePickId: 1,
      elementPickId: physicalElementPickId,
      facePickId: physicalFacePickId,
      nodePickId: physicalNodePickId,
    },
    expectedElementId: physicalElementPickId - 1,
    expectedNodeId: physicalNodePickId - 1,
    baseWorkloadDetails: {
      elements: elements.length,
      faces: triangles.faces?.length ?? 0,
      nodes: (input.part.nodePositions?.length ?? 0) / 3,
      renderedTriangles: subsetIndices.length / 3,
      nodeTriangleFaceIndexBytes:
        semantic.nodeTriangleFaceOffsets.byteLength + semantic.nodeTriangleFaceIds.byteLength,
      semanticIndexSetupMs,
    },
  };
}

function assertDirectElementHit(setup: PickBenchmarkSetup): void {
  const hit = resolvePickHit(setup.context, setup.directIds, [0, 0, 0]);
  const expectedElementId = setup.directIds.elementPickId - 1;
  if (hit?.kind !== "element" || hit.elementId !== expectedElementId) {
    throw new Error(
      `Direct pick resolved ${hit?.kind ?? "nothing"} instead of element ${expectedElementId}`,
    );
  }
}

function assertDeepestTriangleHit(setup: PickBenchmarkSetup): void {
  const hit = resolvePickHit(setup.context, setup.physicalIds, [0, 0, 0]);
  if (
    hit?.kind !== "node" ||
    hit.elementId !== setup.expectedElementId ||
    hit.nodeId !== setup.expectedNodeId
  ) {
    throw new Error(
      `Deepest pick resolved ${hit?.kind ?? "nothing"} instead of node ${setup.expectedNodeId}`,
    );
  }
}
