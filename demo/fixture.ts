import { createPanelFixture, type PanelDimensions } from "../src/fixture/panel";
import {
  createCamera,
  resizeCamera,
  type Camera,
  type Color,
  type Geometry,
  type PartId,
  type Scene,
} from "../src/index";

/**
 * Everything the demo renders derives from one deterministic panel fixture:
 * the scene, part colors, and the initial camera framing the model.
 */
export interface DemoFixture {
  readonly scene: Scene;
  readonly dimensions: PanelDimensions;
  readonly geometryByPartId: ReadonlyMap<PartId, Geometry>;
  readonly partColors: ReadonlyMap<PartId, Color>;
  readonly fallbackColor: Color;
  readonly initialCamera: Camera;
}

/** Builds the deterministic panel fixture and the theme used by both renderers. */
export function createDemoFixture(width: number, height: number): DemoFixture {
  const { scene, dimensions, partIds } = createPanelFixture();
  const geometryByPartId = new Map<PartId, Geometry>();
  for (const part of scene.parts.values()) {
    geometryByPartId.set(part.id, part.geometry);
  }
  const partColors = new Map<PartId, Color>([
    [partIds.shell, { r: 0.23, g: 0.51, b: 0.96, a: 1 }],
    [partIds.stiffenerX, { r: 0.35, g: 0.82, b: 0.72, a: 1 }],
    [partIds.stiffenerY, { r: 0.95, g: 0.68, b: 0.32, a: 1 }],
  ]);
  const initialCamera = resizeCamera(
    createCamera({
      target: [dimensions.width / 2, dimensions.depth / 2, dimensions.stiffenerHeight / 2],
      position: [dimensions.width / 2 + 3, dimensions.depth / 2 + 3, 6],
    }),
    width,
    height,
  );
  return {
    scene,
    dimensions,
    geometryByPartId,
    partColors,
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    initialCamera,
  };
}
