import {
  createCamera,
  resizeCamera,
  type Camera,
  type Color,
  type Geometry,
  type PartId,
  type Scene,
} from "../src/index";
import { createElementFixture, type ElementFixture } from "../src/fixture/element-fixture";

/**
 * Everything the demo renders derives from one deterministic element gallery
 * fixture: the scene, part colors, and the initial camera framing the model.
 */
export interface DemoFixture {
  readonly scene: Scene;
  readonly elementFixture: ElementFixture;
  readonly geometryByPartId: ReadonlyMap<PartId, Geometry>;
  readonly partColors: ReadonlyMap<PartId, Color>;
  readonly fallbackColor: Color;
  readonly initialCamera: Camera;
}

/** Builds the element gallery fixture and the theme used by both renderers. */
export function createDemoFixture(width: number, height: number): DemoFixture {
  const elementFixture = createElementFixture();
  const geometryByPartId = new Map<PartId, Geometry>();
  for (const part of elementFixture.scene.parts.values()) {
    geometryByPartId.set(part.id, part.geometry);
  }
  const parts = elementFixture.partIds;
  const partColors = new Map<PartId, Color>([
    [parts.hexSolid, { r: 0.32, g: 0.5, b: 0.68, a: 1 }],
    [parts.hexSurface, { r: 0.48, g: 0.64, b: 0.8, a: 1 }],
    [parts.hexEdges, { r: 0.2, g: 0.34, b: 0.5, a: 1 }],
    [parts.tetSolid, { r: 0.74, g: 0.42, b: 0.25, a: 1 }],
    [parts.tetSurface, { r: 0.86, g: 0.58, b: 0.38, a: 1 }],
    [parts.tetEdges, { r: 0.56, g: 0.28, b: 0.16, a: 1 }],
    [parts.points, { r: 0.9, g: 0.52, b: 0.16, a: 1 }],
    [parts.lines, { r: 0.2, g: 0.54, b: 0.5, a: 1 }],
  ]);
  const bounds = elementFixture.bounds;
  const initialCamera = resizeCamera(
    createCamera({
      target: [
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
      ],
      // The gallery is wide relative to its depth. A perspective camera needs
      // a longer stand-off than the orthographic framing to keep the full
      // assembly visible at the default 60-degree field of view.
      position: perspectivePosition(bounds, width / Math.max(1, height)),
    }),
    width,
    height,
  );
  return {
    scene: elementFixture.scene,
    elementFixture,
    geometryByPartId,
    partColors,
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    initialCamera,
  };
}

function perspectivePosition(
  bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly maxZ: number;
  },
  aspect: number,
): [number, number, number] {
  const target: [number, number, number] = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ];
  const halfFov = Math.PI / 6;
  const verticalDistance = (bounds.maxY - bounds.minY) / (2 * Math.tan(halfFov));
  const horizontalDistance =
    (bounds.maxX - bounds.minX) / (2 * Math.tan(halfFov) * Math.max(0.5, aspect));
  const distance = Math.max(verticalDistance, horizontalDistance, bounds.maxZ - bounds.minZ) * 1.35;
  const direction = normalize([0.72, 0.55, 1]);
  return [
    target[0] + direction[0] * distance,
    target[1] + direction[1] * distance,
    target[2] + direction[2] * distance,
  ];
}

function normalize(vector: readonly [number, number, number]): [number, number, number] {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
  return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude];
}
