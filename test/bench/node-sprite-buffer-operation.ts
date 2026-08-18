import { buildNodeSpritePickIds } from "../../src/renderer/picking/node-topology";
import { buildNodeSpriteBuffers } from "../../src/renderer/resources/point-sprites";
import type { OperationSpec } from "./operation-report";
import type { NodeSelectionFixture } from "./node-selection-sync-operation";

/** Measures compact indexed node-sprite GPU-payload construction on the large fixture. */
export function nodeSpriteBufferOperation(fixture: NodeSelectionFixture): OperationSpec {
  const pickIds = buildNodeSpritePickIds(fixture.part);
  const positions = fixture.part.nodePositions ?? new Float32Array();
  if (pickIds.length !== fixture.nodeCount) throw new Error("Node sprite coverage changed");
  return {
    name: "node-build-sprite-buffers-cold",
    workloadUnit: "authored node centers encoded as compact indexed sprites",
    workloadCount: pickIds.length,
    workloadDetails: {
      nodeCount: fixture.nodeCount,
      elementCount: fixture.elementCount,
      inputPositionBytes: positions.byteLength,
      inputIdBytes: pickIds.byteLength,
      outputPositionBytes: pickIds.length * 3 * Float32Array.BYTES_PER_ELEMENT,
      outputIdBytes: pickIds.length * Uint32Array.BYTES_PER_ELEMENT,
      outputIndexBytes: pickIds.length * 6 * Uint32Array.BYTES_PER_ELEMENT,
      gpuPayloadBytesPerNode: 40,
      eliminatedGpuPayloadBytesPerNode: 48,
      eliminatedGpuPayloadBytes: pickIds.length * 48,
      sequentialSourceArraysReused: 2,
    },
    run: () => {
      assertNodeSpriteBuffers(buildNodeSpriteBuffers(positions, pickIds), positions, pickIds);
    },
  };
}

function assertNodeSpriteBuffers(
  buffers: ReturnType<typeof buildNodeSpriteBuffers>,
  positions: Float32Array,
  pickIds: Uint32Array,
): void {
  const lastSprite = pickIds.length - 1;
  if (
    buffers.positions !== positions ||
    buffers.ids !== pickIds ||
    buffers.positions.length !== pickIds.length * 3 ||
    buffers.ids.length !== pickIds.length ||
    buffers.indices.length !== pickIds.length * 6 ||
    buffers.ids[0] !== pickIds[0] ||
    buffers.ids.at(-1) !== pickIds[lastSprite] ||
    buffers.indices.at(-1) !== pickIds.length * 4 - 1
  ) {
    throw new Error("Node sprite expansion changed");
  }
}
