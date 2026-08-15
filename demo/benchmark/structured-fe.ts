import { createElement, type Element, type NodeId } from "../../src/elements/element";
import { createElementModel, type Body, type ElementModel } from "../../src/elements/model";
import { facesOfElement, type FaceIdRef } from "../../src/elements/faces";
import { HEX20_SHAPE, HEX8_SHAPE, QUAD8_SHAPE, QUAD_SHAPE } from "../../src/elements/shapes";
import { elementPart } from "../../src/geometry/heterogeneous-element-mesh";
import type { Part } from "../../src/geometry/part";

export type StructuredFeFamily = "quad" | "quad8" | "hex8" | "hex20";

/** Builds one structured FE part through the canonical element tessellation path. */
export function createStructuredFePart(
  partId: number,
  family: StructuredFeFamily,
  gridSize: number,
): Part {
  const model = createStructuredFeModel(family, gridSize);
  const body: Body = {
    id: 1,
    name: `${family} structured body`,
    elementIds: model.elements.map((element) => element.id),
  };
  const faceSubset = family === "quad" || family === "quad8" ? allSurfaceFaces(model) : undefined;
  const authoredModel = createElementModel([...model.nodes], model.elements, { bodies: [body] });
  const options = faceSubset === undefined ? {} : { faceSubset };
  return elementPart(partId, authoredModel, options);
}

/** Builds a deterministic shared-node structured model for one supported FE family. */
export function createStructuredFeModel(
  family: StructuredFeFamily,
  gridSize: number,
): ElementModel {
  if (!Number.isInteger(gridSize) || gridSize < 1) {
    throw new Error("structured FE grid size must be a positive integer");
  }
  const builder = new StructuredNodeBuilder();
  const elements: Element[] = [];
  let id = 1;
  if (family === "quad" || family === "quad8") {
    for (let y = 0; y < gridSize; y += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        const corners = quadCorners(builder, x, y);
        const nodeIds =
          family === "quad" ? corners : [...corners, ...quadMidEdges(builder, corners)];
        elements.push(createElement(id, family === "quad" ? QUAD_SHAPE : QUAD8_SHAPE, nodeIds));
        id += 1;
      }
    }
  } else {
    for (let z = 0; z < gridSize; z += 1) {
      for (let y = 0; y < gridSize; y += 1) {
        for (let x = 0; x < gridSize; x += 1) {
          const corners = hexCorners(builder, x, y, z);
          const nodeIds =
            family === "hex8" ? corners : [...corners, ...hexMidEdges(builder, corners)];
          elements.push(createElement(id, family === "hex8" ? HEX8_SHAPE : HEX20_SHAPE, nodeIds));
          id += 1;
        }
      }
    }
  }
  return createElementModel(builder.positions, elements);
}

class StructuredNodeBuilder {
  readonly positions: number[] = [];
  private readonly nodes = new Map<string, NodeId>();

  getOrCreate(key: string, position: readonly [number, number, number]): NodeId {
    const existing = this.nodes.get(key);
    if (existing !== undefined) return existing;
    const id = this.positions.length / 3;
    this.nodes.set(key, id);
    this.positions.push(position[0], position[1], position[2]);
    return id;
  }

  position(nodeId: NodeId): readonly [number, number, number] {
    return [
      this.positions[nodeId * 3] ?? 0,
      this.positions[nodeId * 3 + 1] ?? 0,
      this.positions[nodeId * 3 + 2] ?? 0,
    ];
  }
}

type QuadCorners = readonly [NodeId, NodeId, NodeId, NodeId];
type HexCorners = readonly [NodeId, NodeId, NodeId, NodeId, NodeId, NodeId, NodeId, NodeId];

function quadCorners(builder: StructuredNodeBuilder, x: number, y: number): QuadCorners {
  return [
    builder.getOrCreate(`c:${x}:${y}:0`, [x, y, 0]),
    builder.getOrCreate(`c:${x + 1}:${y}:0`, [x + 1, y, 0]),
    builder.getOrCreate(`c:${x + 1}:${y + 1}:0`, [x + 1, y + 1, 0]),
    builder.getOrCreate(`c:${x}:${y + 1}:0`, [x, y + 1, 0]),
  ];
}

function hexCorners(builder: StructuredNodeBuilder, x: number, y: number, z: number): HexCorners {
  return [
    corner(builder, x, y, z),
    corner(builder, x + 1, y, z),
    corner(builder, x + 1, y + 1, z),
    corner(builder, x, y + 1, z),
    corner(builder, x, y, z + 1),
    corner(builder, x + 1, y, z + 1),
    corner(builder, x + 1, y + 1, z + 1),
    corner(builder, x, y + 1, z + 1),
  ];
}

function corner(builder: StructuredNodeBuilder, x: number, y: number, z: number): NodeId {
  return builder.getOrCreate(`c:${x}:${y}:${z}`, [x, y, z]);
}

function quadMidEdges(
  builder: StructuredNodeBuilder,
  corners: QuadCorners,
): readonly [NodeId, NodeId, NodeId, NodeId] {
  return [
    midNode(builder, corners[0], corners[1]),
    midNode(builder, corners[1], corners[2]),
    midNode(builder, corners[2], corners[3]),
    midNode(builder, corners[3], corners[0]),
  ];
}

function hexMidEdges(
  builder: StructuredNodeBuilder,
  corners: HexCorners,
): readonly [
  NodeId,
  NodeId,
  NodeId,
  NodeId,
  NodeId,
  NodeId,
  NodeId,
  NodeId,
  NodeId,
  NodeId,
  NodeId,
  NodeId,
] {
  return [
    midNode(builder, corners[0], corners[1]),
    midNode(builder, corners[1], corners[2]),
    midNode(builder, corners[2], corners[3]),
    midNode(builder, corners[3], corners[0]),
    midNode(builder, corners[4], corners[5]),
    midNode(builder, corners[5], corners[6]),
    midNode(builder, corners[6], corners[7]),
    midNode(builder, corners[7], corners[4]),
    midNode(builder, corners[0], corners[4]),
    midNode(builder, corners[1], corners[5]),
    midNode(builder, corners[2], corners[6]),
    midNode(builder, corners[3], corners[7]),
  ];
}

function midNode(builder: StructuredNodeBuilder, first: NodeId, second: NodeId): NodeId {
  const [ax, ay, az] = builder.position(first);
  const [bx, by, bz] = builder.position(second);
  return builder.getOrCreate(`m:${Math.min(first, second)}:${Math.max(first, second)}`, [
    (ax + bx) / 2,
    (ay + by) / 2,
    (az + bz) / 2,
  ]);
}

function allSurfaceFaces(model: ElementModel): readonly FaceIdRef[] {
  return model.elements.flatMap((element) =>
    facesOfElement(element).map(({ elementId, faceIndex }) => ({ elementId, faceIndex })),
  );
}
