import { createElement, type Element, type NodeId } from "../elements/element";
import { createElementModel, type ElementModel } from "../elements/model";
import { HEX8_SHAPE } from "../elements/shapes";

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

/** The bolt mesh: a 1.6 m shaft below a 4 x 4 m square head. */
export function createBoltModel(): ElementModel {
  return gridModel([
    {
      minX: -0.8,
      minY: -4,
      minZ: -0.8,
      maxX: 0.8,
      maxY: 3,
      maxZ: 0.8,
      cellsX: 1,
      cellsY: 1,
      cellsZ: 1,
    },
    {
      minX: -2,
      minY: 3,
      minZ: -2,
      maxX: 2,
      maxY: 5,
      maxZ: 2,
      cellsX: 1,
      cellsY: 1,
      cellsZ: 1,
    },
  ]);
}

/** The flat washer mesh: a thin 2.8 x 2.8 m slab around the shaft. */
export function createWasherModel(): ElementModel {
  return gridModel([
    {
      minX: -1.4,
      minY: -0.25,
      minZ: -1.4,
      maxX: 1.4,
      maxY: 0.25,
      maxZ: 1.4,
      cellsX: 1,
      cellsY: 1,
      cellsZ: 1,
    },
  ]);
}

/** The nut mesh: a 3 x 3 m box threaded on the shaft end. */
export function createNutModel(): ElementModel {
  return gridModel([
    {
      minX: -1.5,
      minY: -1,
      minZ: -1.5,
      maxX: 1.5,
      maxY: 1,
      maxZ: 1.5,
      cellsX: 1,
      cellsY: 1,
      cellsZ: 1,
    },
  ]);
}
