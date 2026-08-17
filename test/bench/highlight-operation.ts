import type { EmphasisUpdate } from "../../src/renderer/resources/element-resources";
import { defaultStyle } from "../../src/renderer/resources/foundation";
import {
  createHighlightStorage,
  writeElementHighlights,
} from "../../src/renderer/selection/highlight-storage";
import type { InstanceStorage } from "../../src/renderer/resources/draw-resources";
import { fakeGpuDevice, installGpuGlobals } from "../renderer/fake-gpu";
import type { OperationSpec } from "./operation-report";

const HIGH_WATER_ACTIVE_RECORDS = 131_712;

/**
 * Builds a high-water sparse highlight table before timing one-record hover
 * moves. The returned operation measures the retained CPU mirror and table
 * diff path, not fixture construction or initial table growth.
 */
export function highWaterHighlightHoverOperation(): OperationSpec {
  installGpuGlobals();
  const gpu = fakeGpuDevice();
  const emptyHighlight = createHighlightStorage(gpu.device, 1);
  const storage = {
    highlight: emptyHighlight,
    emptyHighlight,
    highlightOwned: false,
    bindGroup: undefined,
  } as unknown as InstanceStorage;
  const highWaterUpdates = Array.from({ length: HIGH_WATER_ACTIVE_RECORDS }, (_, index) =>
    highlightUpdate(index),
  );
  writeElementHighlights(gpu.device, storage, highWaterUpdates);
  const highWaterTable = new Uint32Array(storage.highlight.data.buffer);
  const highWaterBucketCount = highWaterTable[1] ?? 0;
  const retainedSparseCapacityRecords = storage.highlight.sparseCapacity;
  if (highWaterBucketCount <= 0 || retainedSparseCapacityRecords <= 0) {
    throw new Error("High-water highlight fixture did not allocate sparse capacity");
  }

  writeElementHighlights(gpu.device, storage, [highlightUpdate(1)]);
  let nextElementId = 2;
  return {
    name: "highlight-hover-one-record-after-131k-high-water",
    workloadUnit: "active sparse records per one-record hover",
    workloadCount: 1,
    workloadDetails: {
      activeRecords: 1,
      highWaterActiveRecords: HIGH_WATER_ACTIVE_RECORDS,
      highWaterBucketCount,
      retainedSparseCapacityRecords,
    },
    run: () => {
      writeElementHighlights(gpu.device, storage, [highlightUpdate(nextElementId)]);
      nextElementId = nextElementId === 2 ? 3 : 2;
    },
  };
}

function highlightUpdate(elementId: number): EmphasisUpdate {
  return {
    slot: 0,
    elementPickId: elementId + 1,
    facePickId: 0,
    nodePickId: 0,
    style: defaultStyle,
  };
}
