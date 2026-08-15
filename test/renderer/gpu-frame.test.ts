import { afterEach, describe, expect, it } from "vitest";
import {
  AUTHORED_PRIMITIVE_PRECEDENCE,
  cameraKeyLightDirection,
  cameraViewDirection,
  needsWeightedTransparency,
  nodeSizeDevicePixels,
  pointSizeDevicePixels,
} from "../../src/renderer/core/gpu-frame";
import {
  orbitPivotAxisProjection,
  orbitPivotMetrics,
} from "../../src/renderer/helpers/gpu-orbit-pivot";
import {
  createCamera,
  orbitCamera,
  panCamera,
  resizeCamera,
  setProjection,
  type Camera,
  zoomCamera,
  zoomCameraAtPoint,
} from "../../src/camera/camera";
import { cross, dot, normalize, scale, subtract, type Vec3 } from "../../src/math/vec3";
import { beginColorPass } from "../../src/renderer/gpu-passes";

const originalDevicePixelRatio = globalThis.devicePixelRatio;

afterEach(() => {
  Object.defineProperty(globalThis, "devicePixelRatio", {
    configurable: true,
    value: originalDevicePixelRatio,
  });
});

describe("pointSizeDevicePixels", () => {
  it("scales CSS point size by devicePixelRatio", () => {
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2 });
    expect(pointSizeDevicePixels(8)).toBe(16);
    expect(pointSizeDevicePixels(8, 1)).toBe(8);
    expect(pointSizeDevicePixels(8, 3)).toBe(24);
  });

  it("never returns less than one device pixel", () => {
    expect(pointSizeDevicePixels(0.1, 1)).toBe(1);
  });
});

describe("authored primitive precedence", () => {
  it("keeps surface, line, and point tie order independent of part ids", () => {
    expect(AUTHORED_PRIMITIVE_PRECEDENCE).toEqual(["triangles", "lines", "points"]);
  });
});

describe("fixed-size sprite conversions", () => {
  it("converts fixed-size node diameters using the current DPR", () => {
    expect(nodeSizeDevicePixels(6, 2)).toBe(12);
  });
});

describe("weighted transparency contributors", () => {
  const emptyFrame = {
    transparentCalls: [],
    selectionCalls: [],
    selectedNodeCalls: [],
    originTriadEnabled: false,
    originTriadAvailable: false,
  } as const;

  it("skips weighted targets when no visible contributor is active", () => {
    expect(needsWeightedTransparency(emptyFrame, false)).toBe(false);
  });

  it.each([
    ["transparent scene calls", { transparentCalls: [{}] }],
    ["selected instances", { selectionCalls: [{}] }],
    ["selected nodes", { selectedNodeCalls: [{}] }],
    ["the origin triad", { originTriadEnabled: true, originTriadAvailable: true }],
  ] as const)("retains weighted targets for %s", (_label, change) => {
    expect(needsWeightedTransparency({ ...emptyFrame, ...change }, false)).toBe(true);
  });

  it("retains weighted targets for an active orbit pivot", () => {
    expect(needsWeightedTransparency(emptyFrame, true)).toBe(true);
  });
});

describe("visible pass attachments", () => {
  it("stores selected-pixel stencil coverage for the hidden selection pass", () => {
    let descriptor: GPURenderPassDescriptor | undefined;
    const pass = {} as GPURenderPassEncoder;
    const encoder = {
      beginRenderPass: (next: GPURenderPassDescriptor) => {
        descriptor = next;
        return pass;
      },
    } as GPUCommandEncoder;

    expect(beginColorPass(encoder, {} as GPUTextureView, {} as GPUTextureView, undefined)).toBe(
      pass,
    );
    expect(descriptor?.depthStencilAttachment?.stencilStoreOp).toBe("store");
  });
});

describe("cameraKeyLightDirection", () => {
  it.each([
    createCamera({ position: [4, 3, 6], target: [0, 0, 0] }),
    createCamera({ position: [0, 4, 0], target: [0, 0, 0], up: [1, 0, 0] }),
    createCamera({ position: [0, -4, 0], target: [0, 0, 0], up: [1, 0, 0] }),
  ])("returns a finite normalized direction for valid camera #%#", (camera) => {
    const direction = cameraKeyLightDirection(camera);
    expect(direction.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...direction)).toBeCloseTo(1);
  });

  it("keeps a constant upper-left direction in camera space through a 180-degree orbit", () => {
    const initial = createCamera({ position: [0, 0, 4], target: [0, 0, 0] });
    const rotated = orbitCamera(initial, Math.PI, 0);
    const baseline = cameraSpaceDirection(initial, cameraKeyLightDirection(initial));
    const afterOrbit = cameraSpaceDirection(rotated, cameraKeyLightDirection(rotated));

    expect(baseline[0]).toBeLessThan(0);
    expect(baseline[1]).toBeGreaterThan(0);
    expect(baseline[2]).toBeGreaterThan(0);
    for (let index = 0; index < 3; index += 1) {
      expect(afterOrbit[index]).toBeCloseTo(baseline[index] ?? NaN, 12);
    }
  });

  it("stays finite through continuous pole-crossing camera frames", () => {
    let camera = createCamera({ position: [0, 0, 4], target: [0, 0, 0] });
    for (let step = 0; step < 8; step += 1) {
      camera = orbitCamera(camera, 0.2, Math.PI / 2);
      const light = cameraKeyLightDirection(camera);
      const projection = orbitPivotAxisProjection(camera, [1, 0, 0]);
      expect(light.every(Number.isFinite)).toBe(true);
      expect(projection.every(Number.isFinite)).toBe(true);
    }
  });

  it("keeps the key direction invariant under view-preserving navigation", () => {
    const camera = resizeCamera(
      createCamera({ position: [4, 3, 6], target: [0, 0, 0] }),
      1440,
      900,
    );
    const baseline = cameraKeyLightDirection(camera);
    const variants = [
      panCamera(camera, 2, -1),
      zoomCamera(camera, -0.75),
      zoomCameraAtPoint(camera, -0.75, [0.8, -0.3, 0.5]),
      setProjection(camera, "orthographic"),
      setProjection(setProjection(camera, "orthographic"), "perspective"),
    ];

    for (const variant of variants) {
      const direction = cameraKeyLightDirection(variant);
      expect(direction.every(Number.isFinite)).toBe(true);
      for (let index = 0; index < 3; index += 1) {
        expect(direction[index]).toBeCloseTo(baseline[index] ?? NaN, 12);
      }
    }
  });
});

describe("cameraViewDirection", () => {
  it("returns a finite normalized direction from the camera toward its target", () => {
    const camera = createCamera({ position: [4, 3, 6], target: [0, 0, 0] });
    const direction = cameraViewDirection(camera);
    expect(direction.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...direction)).toBeCloseTo(1);
    expect(direction).toEqual([
      expect.closeTo(4 / Math.sqrt(61), 12),
      expect.closeTo(3 / Math.sqrt(61), 12),
      expect.closeTo(6 / Math.sqrt(61), 12),
    ]);
  });

  it("changes with orbit but remains invariant under pan, zoom, and projection changes", () => {
    const camera = resizeCamera(
      createCamera({ position: [4, 3, 6], target: [0, 0, 0] }),
      1440,
      900,
    );
    const baseline = cameraViewDirection(camera);
    const rotated = cameraViewDirection(orbitCamera(camera, Math.PI / 2, 0));
    expect(rotated).not.toEqual(baseline);
    for (const variant of [
      panCamera(camera, 2, -1),
      zoomCamera(camera, -0.75),
      setProjection(camera, "orthographic"),
    ]) {
      expect(cameraViewDirection(variant)).toEqual(baseline);
    }
  });
});

function cameraSpaceDirection(camera: Camera, direction: Vec3): Vec3 {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = normalize(cross(right, forward));
  return [dot(direction, right), dot(direction, up), dot(direction, scale(forward, -1))];
}

describe("orbit pivot widget", () => {
  it("keeps its dimensions in device pixels across display densities", () => {
    expect(orbitPivotMetrics(1)).toEqual({
      axisLength: 28,
      lineWidth: 3,
      arrowLength: 8,
      arrowWidth: 6,
    });
    expect(orbitPivotMetrics(2)).toEqual({
      axisLength: 56,
      lineWidth: 6,
      arrowLength: 16,
      arrowWidth: 12,
    });
  });

  it("foreshortens a world axis as it faces the camera", () => {
    const camera = resizeCamera(createCamera({ position: [4, 3, 6], target: [0, 0, 0] }), 800, 600);
    const x = orbitPivotAxisProjection(camera, [1, 0, 0]);
    const y = orbitPivotAxisProjection(camera, [0, 1, 0]);
    const z = orbitPivotAxisProjection(camera, [0, 0, 1]);
    expect(Math.hypot(...x)).toBeLessThan(1);
    expect(Math.hypot(...y)).toBeLessThan(1);
    expect(Math.hypot(...z)).toBeLessThan(1);
    expect(x).not.toEqual(y);
    expect(y).not.toEqual(z);

    const faceOn = orbitPivotAxisProjection(
      createCamera({ position: [5, 0, 0], target: [0, 0, 0] }),
      [1, 0, 0],
    );
    expect(faceOn).toEqual([0, 0]);
  });
});
