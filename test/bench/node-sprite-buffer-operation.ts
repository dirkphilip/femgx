import { buildNodeSpritePickIds } from "../../src/renderer/picking/node-topology";
import { compactNodeSpriteData } from "../../src/renderer/resources/point-sprites";
import type { OperationSpec } from "./operation-report";
import type { NodeSelectionFixture } from "./node-selection-sync-operation";

/** Measures compact procedural-node GPU-payload construction on the large fixture. */
export function nodeSpriteBufferOperation(fixture: NodeSelectionFixture): OperationSpec {
  const pickIds = buildNodeSpritePickIds(fixture.part);
  const positions = fixture.part.nodePositions ?? new Float32Array();
  if (pickIds.length !== fixture.nodeCount) throw new Error("Node sprite coverage changed");
  return {
    name: "node-compact-sprite-data-cold",
    workloadUnit: "authored node centers addressed by procedural quad instances",
    workloadCount: pickIds.length,
    workloadDetails: {
      nodeCount: fixture.nodeCount,
      elementCount: fixture.elementCount,
      inputPositionBytes: positions.byteLength,
      inputIdBytes: pickIds.byteLength,
      outputPositionBytes: pickIds.length * 3 * Float32Array.BYTES_PER_ELEMENT,
      outputIdBytes: pickIds.length * Uint32Array.BYTES_PER_ELEMENT,
      outputIndexBytes: 0,
      gpuPayloadBytesPerNode: 16,
      eliminatedGpuPayloadBytesPerNode: 24,
      eliminatedGpuPayloadBytes: pickIds.length * 24,
      nodeDrawVertexCount: 4,
      nodeDrawInstanceCount: pickIds.length,
      sequentialSourceArraysReused: 2,
    },
    run: () => {
      assertNodeSpriteData(compactNodeSpriteData(positions, pickIds), positions, pickIds);
    },
  };
}

function assertNodeSpriteData(
  buffers: ReturnType<typeof compactNodeSpriteData>,
  positions: Float32Array,
  pickIds: Uint32Array,
): void {
  const lastSprite = pickIds.length - 1;
  if (
    buffers.positions !== positions ||
    buffers.ids !== pickIds ||
    buffers.positions.length !== pickIds.length * 3 ||
    buffers.ids.length !== pickIds.length ||
    buffers.ids[0] !== pickIds[0] ||
    buffers.ids.at(-1) !== pickIds[lastSprite]
  ) {
    throw new Error("Node sprite compaction changed");
  }
}
