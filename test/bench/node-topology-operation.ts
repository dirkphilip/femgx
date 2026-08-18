import {
  buildNodeSpritePickIds,
  buildPackedNodeTopologyData,
} from "../../src/renderer/picking/node-topology";
import type { OperationSpec } from "./operation-report";
import type { NodeSelectionFixture } from "./node-selection-sync-operation";

interface PackedNodeTopologyFacts {
  readonly faceRecordCount: number;
  readonly rangeCount: number;
  readonly ownerOccurrenceCount: number;
  readonly packedBytes: number;
  readonly firstOwnerCount: number;
  readonly lastOwnerOffset: number;
  readonly lastOwnerCount: number;
  readonly firstBodyPickId: number;
  readonly firstElementPickId: number;
  readonly lastBodyPickId: number;
  readonly lastElementPickId: number;
}

/** Measures final topology construction; memory facts exclude authored source and native GPU data. */
export function packedNodeTopologyOperation(fixture: NodeSelectionFixture): OperationSpec {
  const spritePickIds = buildNodeSpritePickIds(fixture.part);
  const expected = packedTopologyFacts(buildPackedNodeTopologyData(fixture.part, spritePickIds));
  assertTet4TopologyFacts(expected, fixture);
  const rawStagingBytes = rawTopologyBytes(spritePickIds.length, expected.ownerOccurrenceCount);
  const ordinalStagingBytes = spritePickIds.byteLength;
  const temporaryBytes = fixture.nodeCount * 12 + spritePickIds.length * 8;
  assertTet4MemoryFacts(rawStagingBytes, ordinalStagingBytes, temporaryBytes);
  return {
    name: "node-build-and-pack-topology-cold",
    workloadUnit: "element-node owners constructed directly in final packed topology",
    workloadCount: expected.ownerOccurrenceCount,
    workloadDetails: {
      nodeCount: fixture.nodeCount,
      elementCount: fixture.elementCount,
      faceRecordCount: expected.faceRecordCount,
      rangeCount: expected.rangeCount,
      ownerOccurrenceCount: expected.ownerOccurrenceCount,
      suppliedSpritePickIdInputBytes: spritePickIds.byteLength,
      retainedPackedTopologyBytes: expected.packedBytes,
      builderTemporaryTypedArrayBytes: temporaryBytes,
      eliminatedRawTopologyStagingBytes: rawStagingBytes,
      eliminatedElementOrdinalStagingBytes: ordinalStagingBytes,
      eliminatedTotalStagingBytes: rawStagingBytes + ordinalStagingBytes,
      authoredSourceBytesIncluded: 0,
      nativeGpuAllocationBytesIncluded: 0,
      firstOwnerCount: expected.firstOwnerCount,
      lastOwnerOffset: expected.lastOwnerOffset,
      lastOwnerCount: expected.lastOwnerCount,
      firstBodyPickId: expected.firstBodyPickId,
      firstElementPickId: expected.firstElementPickId,
      lastBodyPickId: expected.lastBodyPickId,
      lastElementPickId: expected.lastElementPickId,
    },
    run: () => {
      const actual = packedTopologyFacts(buildPackedNodeTopologyData(fixture.part, spritePickIds));
      if (!sameTopologyFacts(actual, expected)) throw new Error("Packed node topology changed");
    },
  };
}

function packedTopologyFacts(data: Uint32Array): PackedNodeTopologyFacts {
  const faceRecordCount = data[0] ?? 0;
  const rangeCount = data[1] ?? 0;
  const ownerOccurrenceCount = data[2] ?? 0;
  const faceEnd = 4 + faceRecordCount * 5;
  const rangeEnd = faceEnd + rangeCount * 2;
  const bodyEnd = rangeEnd + ownerOccurrenceCount * 2;
  const elementEnd = bodyEnd + ownerOccurrenceCount * 2;
  const lastRange = faceEnd + (rangeCount - 1) * 2;
  return {
    faceRecordCount,
    rangeCount,
    ownerOccurrenceCount,
    packedBytes: data.byteLength,
    firstOwnerCount: data[faceEnd + 1] ?? 0,
    lastOwnerOffset: data[lastRange] ?? 0,
    lastOwnerCount: data[lastRange + 1] ?? 0,
    firstBodyPickId: data[rangeEnd] ?? 0,
    firstElementPickId: data[bodyEnd] ?? 0,
    lastBodyPickId: data[bodyEnd - 2] ?? 0,
    lastElementPickId: data[elementEnd - 2] ?? 0,
  };
}

function rawTopologyBytes(spriteCount: number, ownerOccurrenceCount: number): number {
  return spriteCount * 5 * 4 + spriteCount * 2 * 4 + ownerOccurrenceCount * 2 * 4 * 2;
}

function assertTet4MemoryFacts(
  rawStagingBytes: number,
  ordinalStagingBytes: number,
  temporaryBytes: number,
): void {
  if (
    rawStagingBytes !== 9_112_460 ||
    ordinalStagingBytes !== 97_556 ||
    rawStagingBytes + ordinalStagingBytes !== 9_210_016 ||
    temporaryBytes !== 487_780
  ) {
    throw new Error("Large Tet4 node topology memory facts changed");
  }
}

function assertTet4TopologyFacts(
  facts: PackedNodeTopologyFacts,
  fixture: NodeSelectionFixture,
): void {
  if (
    facts.faceRecordCount !== fixture.nodeCount ||
    facts.rangeCount !== fixture.nodeCount ||
    facts.ownerOccurrenceCount !== fixture.elementCount * 4 ||
    facts.lastOwnerOffset + facts.lastOwnerCount !== facts.ownerOccurrenceCount ||
    facts.firstBodyPickId === 0 ||
    facts.firstElementPickId === 0 ||
    facts.lastBodyPickId === 0 ||
    facts.lastElementPickId === 0
  ) {
    throw new Error("Large Tet4 packed node topology facts changed");
  }
}

function sameTopologyFacts(
  actual: PackedNodeTopologyFacts,
  expected: PackedNodeTopologyFacts,
): boolean {
  return (
    actual.faceRecordCount === expected.faceRecordCount &&
    actual.rangeCount === expected.rangeCount &&
    actual.ownerOccurrenceCount === expected.ownerOccurrenceCount &&
    actual.packedBytes === expected.packedBytes &&
    actual.firstOwnerCount === expected.firstOwnerCount &&
    actual.lastOwnerOffset === expected.lastOwnerOffset &&
    actual.lastOwnerCount === expected.lastOwnerCount &&
    actual.firstBodyPickId === expected.firstBodyPickId &&
    actual.firstElementPickId === expected.firstElementPickId &&
    actual.lastBodyPickId === expected.lastBodyPickId &&
    actual.lastElementPickId === expected.lastElementPickId
  );
}
