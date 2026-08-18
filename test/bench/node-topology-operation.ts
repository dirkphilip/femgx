import { buildNodeTopologyData } from "../../src/renderer/picking/node-topology";
import type { OperationSpec } from "./operation-report";
import type { NodeSelectionFixture } from "./node-selection-sync-operation";

interface NodeTopologyFacts {
  readonly faceRecordCount: number;
  readonly rangeCount: number;
  readonly ownerOccurrenceCount: number;
  readonly outputBytes: number;
  readonly firstOwnerCount: number;
  readonly lastOwnerOffset: number;
  readonly lastOwnerCount: number;
  readonly firstBodyPickId: number;
  readonly firstElementPickId: number;
  readonly lastBodyPickId: number;
  readonly lastElementPickId: number;
}

/** Measures cold dense node-topology construction without packing or GPU upload. */
export function nodeTopologyOperation(fixture: NodeSelectionFixture): OperationSpec {
  const expected = topologyFacts(buildNodeTopologyData(fixture.part));
  assertTet4TopologyFacts(expected, fixture);
  return {
    name: "node-build-topology-cold",
    workloadUnit: "element-node owner occurrences written into dense topology",
    workloadCount: expected.ownerOccurrenceCount,
    workloadDetails: {
      nodeCount: fixture.nodeCount,
      elementCount: fixture.elementCount,
      faceRecordCount: expected.faceRecordCount,
      rangeCount: expected.rangeCount,
      ownerOccurrenceCount: expected.ownerOccurrenceCount,
      outputBytes: expected.outputBytes,
      firstOwnerCount: expected.firstOwnerCount,
      lastOwnerOffset: expected.lastOwnerOffset,
      lastOwnerCount: expected.lastOwnerCount,
      firstBodyPickId: expected.firstBodyPickId,
      firstElementPickId: expected.firstElementPickId,
      lastBodyPickId: expected.lastBodyPickId,
      lastElementPickId: expected.lastElementPickId,
    },
    run: () => {
      const actual = topologyFacts(buildNodeTopologyData(fixture.part));
      if (!sameTopologyFacts(actual, expected)) throw new Error("Node topology output changed");
    },
  };
}

function topologyFacts(topology: ReturnType<typeof buildNodeTopologyData>): NodeTopologyFacts {
  const ownerOccurrenceCount = topology.bodyIds.length / 2;
  const lastRange = topology.bodyRanges.length - 2;
  return {
    faceRecordCount: topology.faceBodyPickIds.length / 5,
    rangeCount: topology.bodyRanges.length / 2,
    ownerOccurrenceCount,
    outputBytes:
      topology.faceBodyPickIds.byteLength +
      topology.bodyRanges.byteLength +
      topology.bodyIds.byteLength +
      topology.elementIds.byteLength,
    firstOwnerCount: topology.bodyRanges[1] ?? 0,
    lastOwnerOffset: topology.bodyRanges[lastRange] ?? 0,
    lastOwnerCount: topology.bodyRanges[lastRange + 1] ?? 0,
    firstBodyPickId: topology.bodyIds[0] ?? 0,
    firstElementPickId: topology.elementIds[0] ?? 0,
    lastBodyPickId: topology.bodyIds.at(-2) ?? 0,
    lastElementPickId: topology.elementIds.at(-2) ?? 0,
  };
}

function assertTet4TopologyFacts(facts: NodeTopologyFacts, fixture: NodeSelectionFixture): void {
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
    throw new Error("Large Tet4 node topology facts changed");
  }
}

function sameTopologyFacts(actual: NodeTopologyFacts, expected: NodeTopologyFacts): boolean {
  return (
    actual.faceRecordCount === expected.faceRecordCount &&
    actual.rangeCount === expected.rangeCount &&
    actual.ownerOccurrenceCount === expected.ownerOccurrenceCount &&
    actual.outputBytes === expected.outputBytes &&
    actual.firstOwnerCount === expected.firstOwnerCount &&
    actual.lastOwnerOffset === expected.lastOwnerOffset &&
    actual.lastOwnerCount === expected.lastOwnerCount &&
    actual.firstBodyPickId === expected.firstBodyPickId &&
    actual.firstElementPickId === expected.firstElementPickId &&
    actual.lastBodyPickId === expected.lastBodyPickId &&
    actual.lastElementPickId === expected.lastElementPickId
  );
}
