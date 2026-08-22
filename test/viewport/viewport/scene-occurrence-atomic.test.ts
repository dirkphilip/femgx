import { describe, expect, it } from "vitest";
import {
  createPart,
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  identityScene,
  installNavigator,
  installTestGpuGlobals,
  translationMatrix,
} from "./support";

describe("Viewport direct occurrence transaction", () => {
  it("stages new part geometry before publishing a placement", async () => {
    installTestGpuGlobals();
    installNavigator();
    let fail = false;
    const gpu = fakeGpuDevice({
      onCreateBuffer: (_creation, descriptor) => {
        if (fail && descriptor.label === "femgx uploaded buffer") {
          throw new Error("injected new-part geometry allocation failure");
        }
      },
    });
    const scene = identityScene(false);
    const viewport = await createViewport({ canvas: fakeCanvas(), scene, device: gpu.device });
    viewport.visibility.setPartOccurrenceVisible("1/keep", false);
    viewport.render();
    const bufferStart = gpu.buffers.length;
    const added = createPart(2, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
          primitive: "triangles",
        },
      ],
    });
    fail = true;

    expect(() => {
      viewport.updateScene((update) => {
        update.addPart(added);
        update.addPlacement(1, {
          kind: "part",
          placementId: "failed-new-part",
          partId: 2,
          transform: translationMatrix(3, 0, 0),
        });
      });
    }).toThrow("injected new-part geometry allocation failure");

    expect(viewport.scene).toBe(scene);
    expect(viewport.occurrences.getPartOccurrence("1/failed-new-part")).toBeUndefined();
    expect(viewport.occurrences.isPartOccurrenceVisible("1/keep")).toBe(false);
    expect(gpu.buffers.slice(bufferStart).every(({ destroyed }) => destroyed)).toBe(true);
    fail = false;
    expect(() => {
      viewport.render();
    }).not.toThrow();
    viewport.destroy();
  });
});
