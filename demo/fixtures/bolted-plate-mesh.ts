import {
  createElement,
  createElementModel,
  HEX8_SHAPE,
  type Element,
  type ElementModel,
  type NodeId,
} from "../../src/entries/model";

/**
 * Deterministic hex-mesh builders for the bolted-plate fixture. Each builder
 * returns a conforming CPU-side element model that the fixture tessellates
 * into reusable part geometry; internal to the fixture subsystem.
 */

/** Shared-node hex brick builder keyed by integer grid coordinates. */
class HexNodeBuilder {
  readonly positions: number[] = [];
  private readonly byKey = new Map<string, NodeId>();

  node(x: number, y: number, z: number): NodeId {
    const key = `${x},${y},${z}`;
    const existing = this.byKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.positions.length / 3;
    this.byKey.set(key, id);
    this.positions.push(x, y, z);
    return id;
  }
}

/** The shared-node hex mesh of one axis-aligned box region. */
interface BoxCell {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly cellsX: number;
  readonly cellsY: number;
  readonly cellsZ: number;
}

/** Builds a conforming hex mesh from one or more grid sub-divided boxes. */
function gridModel(boxes: readonly BoxCell[]): ElementModel {
  const builder = new HexNodeBuilder();
  const elements: Element[] = [];
  let id = 1;
  for (const box of boxes) {
    const dx = (box.maxX - box.minX) / box.cellsX;
    const dy = (box.maxY - box.minY) / box.cellsY;
    const dz = (box.maxZ - box.minZ) / box.cellsZ;
    for (let k = 0; k < box.cellsZ; k += 1) {
      for (let j = 0; j < box.cellsY; j += 1) {
        for (let i = 0; i < box.cellsX; i += 1) {
          const x = box.minX + i * dx;
          const y = box.minY + j * dy;
          const z = box.minZ + k * dz;
          elements.push(
            createElement(id, HEX8_SHAPE, [
              builder.node(x, y, z),
              builder.node(x + dx, y, z),
              builder.node(x + dx, y + dy, z),
              builder.node(x, y + dy, z),
              builder.node(x, y, z + dz),
              builder.node(x + dx, y, z + dz),
              builder.node(x + dx, y + dy, z + dz),
              builder.node(x, y + dy, z + dz),
            ]),
          );
          id += 1;
        }
      }
    }
  }
  return createElementModel(builder.positions, elements);
}

/** A plate mesh centered on the origin, spanning the given dimensions. */
export function createPlateModel(
  plateLength: number,
  plateWidth: number,
  plateThickness: number,
): ElementModel {
  const halfLength = plateLength / 2;
  const halfWidth = plateWidth / 2;
  const halfThickness = plateThickness / 2;
  return gridModel([
    {
      minX: -halfLength,
      minY: -halfThickness,
      minZ: -halfWidth,
      maxX: halfLength,
      maxY: halfThickness,
      maxZ: halfWidth,
      cellsX: 3,
      cellsY: 1,
      cellsZ: 2,
    },
  ]);
}

/** The bolt mesh: an 0.8 m shaft below a 1.4 x 1.4 m square head. */
export function createBoltModel(headBaseY: number): ElementModel {
  return gridModel([
    {
      minX: -0.4,
      minY: -4,
      minZ: -0.4,
      maxX: 0.4,
      maxY: headBaseY,
      maxZ: 0.4,
      cellsX: 1,
      cellsY: 1,
      cellsZ: 1,
    },
    {
      minX: -0.7,
      minY: headBaseY,
      minZ: -0.7,
      maxX: 0.7,
      maxY: headBaseY + 1,
      maxZ: 0.7,
      cellsX: 1,
      cellsY: 1,
      cellsZ: 1,
    },
  ]);
}

/** The flat washer mesh: a thin 1.4 x 1.4 m slab around the shaft. */
export function createWasherModel(): ElementModel {
  return gridModel([
    {
      minX: -0.7,
      minY: -0.125,
      minZ: -0.7,
      maxX: 0.7,
      maxY: 0.125,
      maxZ: 0.7,
      cellsX: 1,
      cellsY: 1,
      cellsZ: 1,
    },
  ]);
}

/** The nut mesh: a 1.5 x 1.5 m box threaded on the shaft end. */
export function createNutModel(): ElementModel {
  return gridModel([
    {
      minX: -0.75,
      minY: -0.5,
      minZ: -0.75,
      maxX: 0.75,
      maxY: 0.5,
      maxZ: 0.75,
      cellsX: 1,
      cellsY: 1,
      cellsZ: 1,
    },
  ]);
}
