import { afterEach, describe, expect, it } from "vitest";
import { createPart } from "../../../src/geometry/part";
import { identity, scale, translation } from "../../../src/math/mat4";
import { createResultField } from "../../../src/results/fields";
import { resolveElementalOrientationRecords } from "../../../src/results/orientation-records";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { createScene } from "../../../src/scene/scene";
import {
  normalMatrix3,
  packOrientationRecords,
} from "../../../src/renderer/orientation-glyphs/data";
import { orientationGlyphVertexShader } from "../../../src/renderer/orientation-glyphs/shader";
import {
  createWebGpuRenderer,
  readGpuCostSnapshot,
  setRendererOrientationGlyphs,
} from "../../../src/renderer/gpu-renderer";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

const originalNavigator = globalThis.navigator;
let restoreGpuGlobals: (() => void) | undefined;

afterEach(() => {
  restoreGpuGlobals?.();
  restoreGpuGlobals = undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

function installNavigator(device: GPUDevice): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        getPreferredCanvasFormat: () => "bgra8unorm",
        requestAdapter: () => Promise.resolve({ requestDevice: () => Promise.resolve(device) }),
      },
    },
  });
}

function orientationPart() {
  const positions = new Float32Array([-1, 0, 0, 1, 0, 0, 0, 2, 0]);
  return createPart(1, {
    geometries: [
      {
        positions,
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles",
        nodePickIds: new Uint32Array([1, 2, 3]),
      },
    ],
    nodePositions: positions,
    elements: [
      {
        id: 0,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        bodyId: 4,
      },
    ],
    bodies: [{ id: 4, name: "body", elementIds: [0] }],
  });
}

function orientationRecords() {
  const part = orientationPart();
  const field = createResultField({
    id: "fiber",
    name: "Fiber",
    location: "elemental",
    shape: "vector",
    count: 1,
    unit: "unitless",
    values: new Float32Array([1, 2, 0]),
  });
  return { part, records: resolveElementalOrientationRecords(part, field) };
}

describe("orientation glyph data", () => {
  it("keeps arrowhead minima in CSS pixels across device pixel ratios", () => {
    expect(orientationGlyphVertexShader).toContain("widthPixels: f32");
    expect(orientationGlyphVertexShader).toContain(
      "glyphParams.widthPixels * camera.devicePixelRatio",
    );
    expect(orientationGlyphVertexShader).toContain(
      "max(width * 3.5, 6.0 * camera.devicePixelRatio)",
    );
    expect(orientationGlyphVertexShader).toContain(
      "max(width * 2.5, 3.0 * camera.devicePixelRatio)",
    );
    expect(orientationGlyphVertexShader).toContain("max(width, 0.75 * camera.devicePixelRatio)");
  });

  it("packs anchors, directions, deltas, and ownership into aligned records", () => {
    const records = {
      elementIds: new Uint32Array([7]),
      bodyIds: new Uint32Array([5]),
      anchors: new Float32Array([1, 2, 3]),
      referenceLengths: new Float32Array([4]),
      directions: new Float32Array([0, 1, 0]),
      anchorDeltas: new Float32Array([0.5, 0.25, 0]),
    };
    const packed = packOrientationRecords(records);
    expect(packed.byteLength).toBe(64);
    expect(new Float32Array(packed.buffer).slice(0, 11)).toEqual(
      new Float32Array([1, 2, 3, 4, 0, 1, 0, 0, 0.5, 0.25, 0]),
    );
    expect(new Uint32Array(packed.buffer).slice(12, 14)).toEqual(new Uint32Array([7, 5]));
  });

  it("computes inverse-transpose matrices and rejects singular transforms", () => {
    expect(normalMatrix3(identity())).toEqual(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    expect(normalMatrix3(scale(2, 4, 8))).toEqual(
      new Float32Array([0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.125]),
    );
    expect(() => normalMatrix3(scale(1, 0, 1))).toThrow("singular");
  });

  it("rejects singular normal transforms before uploading glyph state", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const { part, records } = orientationRecords();
    const scene = createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "singular-root",
        placements: [{ kind: "part", partId: 1, transform: scale(1, 0, 1) }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    setRendererOrientationGlyphs(renderer, {
      parts: new Map([[1, records]]),
      mode: "arrow",
      transform: "normal",
      lengthScale: 1,
      widthPixels: 2,
    });

    expect(() => {
      renderer.render(runtime, camera, scene.parts);
    }).toThrow(/occurrence/);
    expect(readGpuCostSnapshot(renderer).writes["vector-glyph"]).toEqual({ calls: 0, bytes: 0 });
    renderer.destroy();
  });

  it("uploads valid normal matrices with the existing glyph records", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const { part, records } = orientationRecords();
    const scene = createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "normal-root",
        placements: [{ kind: "part", partId: 1, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    setRendererOrientationGlyphs(renderer, {
      parts: new Map([[1, records]]),
      mode: "arrow",
      transform: "normal",
      lengthScale: 1,
      widthPixels: 2,
    });

    renderer.render(runtime, camera, scene.parts);

    expect(readGpuCostSnapshot(renderer).writes["vector-glyph"].bytes).toBe(64 + 16 + 48);
    renderer.destroy();
  });

  it("draws one reusable record array across repeated part occurrences", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const { part, records } = orientationRecords();
    const scene = createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 1, transform: translation(3, 0, 0) },
        ],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    setRendererOrientationGlyphs(renderer, {
      parts: new Map([[1, records]]),
      mode: "arrow",
      transform: "direction",
      lengthScale: 1,
      widthPixels: 2,
    });

    renderer.render(runtime, { ...camera, width: 800, height: 600 }, scene.parts);
    const first = readGpuCostSnapshot(renderer);
    expect(first.draws["vector-glyph"]).toEqual({ calls: 2, indices: 18, instances: 4 });
    expect(first.writes["vector-glyph"].bytes).toBe(64 + 16);
    expect(
      gpu.buffers.some(
        (buffer) => buffer.size === 16 && (buffer.usage & GPUBufferUsage.UNIFORM) !== 0,
      ),
    ).toBe(true);

    renderer.render(runtime, { ...camera, width: 800, height: 600 }, scene.parts);
    const second = readGpuCostSnapshot(renderer);
    expect(second.draws["vector-glyph"]).toEqual(first.draws["vector-glyph"]);
    expect(second.writes["vector-glyph"]).toEqual({ calls: 0, bytes: 0 });

    const afterStableFrame = gpu.writes.length;
    setRendererOrientationGlyphs(renderer, {
      parts: new Map([[1, records]]),
      mode: "arrow",
      transform: "direction",
      lengthScale: 1,
      widthPixels: 1.5,
    });
    const widthWrites = gpu.writes.slice(afterStableFrame);
    expect(widthWrites).toHaveLength(1);
    expect(widthWrites[0]?.bytes.byteLength).toBe(16);

    const afterWidth = gpu.writes.length;
    setRendererOrientationGlyphs(renderer, {
      parts: new Map([[1, records]]),
      mode: "arrow",
      transform: "direction",
      lengthScale: 1,
      widthPixels: 1.5,
    });
    expect(gpu.writes.length).toBe(afterWidth);
    renderer.destroy();
  });
});

const camera = {
  mode: "perspective" as const,
  position: [3, 3, 5] as const,
  target: [0, 0, 0] as const,
  up: [0, 1, 0] as const,
  fovY: Math.PI / 3,
  near: 0.01,
  far: 100,
  orthoHeight: 6,
  width: 800,
  height: 600,
};
