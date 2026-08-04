import {
  createCamera,
  createElementFixture,
  resizeCamera,
  type Camera,
  type Color,
  type ElementFixture,
  type Geometry,
  type PartId,
  type Scene,
} from "../src/index";

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
    [parts.hexSolid, { r: 0.23, g: 0.51, b: 0.96, a: 1 }],
    [parts.hexSurface, { r: 0.32, g: 0.6, b: 0.98, a: 1 }],
    [parts.hexEdges, { r: 0.18, g: 0.42, b: 0.85, a: 1 }],
    [parts.tetSolid, { r: 0.95, g: 0.45, b: 0.35, a: 1 }],
    [parts.tetSurface, { r: 0.96, g: 0.56, b: 0.44, a: 1 }],
    [parts.tetEdges, { r: 0.8, g: 0.36, b: 0.28, a: 1 }],
    [parts.points, { r: 0.95, g: 0.78, b: 0.28, a: 1 }],
    [parts.lines, { r: 0.3, g: 0.85, b: 0.7, a: 1 }],
  ]);
  const bounds = elementFixture.bounds;
  const initialCamera = resizeCamera(
    createCamera({
      target: [
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
      ],
      position: [(bounds.minX + bounds.maxX) / 2, 4.5, bounds.maxZ + 5.5],
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
