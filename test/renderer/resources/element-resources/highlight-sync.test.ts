import { expect, it, describe } from "vitest";
import {
  createInteractionState,
  setElementSelected,
  translationMatrix,
  syncElementHighlights,
  createDrawResources,
  encodeInstanceRecord,
  patchInstances,
  defaultStyle,
  buildInstanceLayout,
  fakeGpuDevice,
  installGpuGlobals,
  elementScene,
  partsMap,
} from "./support";

describe("syncElementHighlights", () => {
  it("clears a part's highlight records when its emphasis empties", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, 1, [
        { slot: 0, data: encodeInstanceRecord(translationMatrix(0, 0, 0), defaultStyle, 1) },
      ]);
      const { scene, runtime } = elementScene();
      const layout = buildInstanceLayout(runtime);
      const slotByInstanceId = new Map([
        ["1/0", 0],
        ["1/1", 1],
      ]);
      const sync = {
        device: gpu.device,
        draw,
        runtime,
        layout,
        slotByInstanceId,
        parts: partsMap(scene),
      };
      let interaction = createInteractionState();
      interaction = setElementSelected(
        interaction,
        { partOccurrenceId: "1/0", elementId: 0 },
        true,
      );
      syncElementHighlights(sync, interaction);
      const afterSelect = gpu.writes.length;
      syncElementHighlights(sync, interaction);
      expect(gpu.writes.length).toBe(afterSelect);
      syncElementHighlights(sync, createInteractionState());
      const tail = gpu.writes.slice(afterSelect);
      const count = new Uint32Array(tail[0]?.bytes.buffer ?? new ArrayBuffer(0))[0];
      expect(count, "clearing the last emphasis writes a zero record count").toBe(0);
    } finally {
      restore();
    }
  });

  it("looks up only affected part storages", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, 1, [
        { slot: 0, data: encodeInstanceRecord(translationMatrix(0, 0, 0), defaultStyle, 1) },
      ]);
      Object.defineProperty(draw.storages, Symbol.iterator, {
        value: () => {
          throw new Error("all storages were scanned");
        },
      });
      const { scene, runtime } = elementScene();
      syncElementHighlights(
        {
          device: gpu.device,
          draw,
          runtime,
          layout: buildInstanceLayout(runtime),
          slotByInstanceId: new Map([["1/0", 0]]),
          parts: partsMap(scene),
        },
        createInteractionState(),
        new Set([1]),
        new Map(),
      );
    } finally {
      restore();
    }
  });
});
