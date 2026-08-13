import type { Body, ElementTessellation, FaceTessellation, Geometry } from "../../src/index";

export interface PlanarGridOptions {
  readonly withFaces?: boolean;
  readonly bodyCount?: number;
  readonly elementMode?: "cell" | "aggregate";
}

/** Builds one deterministic indexed planar grid for demo and benchmark owners. */
export function createPlanarGridGeometry(cells: number, options: PlanarGridOptions = {}): Geometry {
  validateGridOptions(cells, options.bodyCount, options.elementMode);
  const side = cells + 1;
  const positions = new Float32Array(side * side * 3);
  const indices = new Uint32Array(cells * cells * 6);
  const elementMode = options.elementMode ?? "cell";
  const elements = elementMode === "cell" ? [] : undefined;
  const faces = options.withFaces === true ? [] : undefined;
  const bodyElements = createBodyElementLists(options.bodyCount);

  for (let y = 0; y <= cells; y += 1) {
    for (let x = 0; x <= cells; x += 1) {
      const offset = (y * side + x) * 3;
      positions[offset] = x / cells;
      positions[offset + 1] = y / cells;
    }
  }
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      appendCell({
        cells,
        x,
        y,
        indices,
        elements,
        faces,
        bodyElements,
      });
    }
  }
  const nodePickIds = new Uint32Array(positions.length / 3);
  for (let node = 0; node < nodePickIds.length; node += 1) nodePickIds[node] = node + 1;
  return {
    positions,
    indices,
    primitive: "triangles",
    nodePickIds,
    nodePositions: positions,
    ...(elements === undefined
      ? { elements: [{ id: 1, primitiveStart: 0, primitiveCount: cells * cells * 2 }] }
      : { elements }),
    ...(faces === undefined ? {} : { faces }),
    ...(bodyElements === undefined ? {} : { bodies: bodyElements.map(toBody) }),
  };
}

interface CellOptions {
  readonly cells: number;
  readonly x: number;
  readonly y: number;
  readonly indices: Uint32Array;
  readonly elements: ElementTessellation[] | undefined;
  readonly faces: FaceTessellation[] | undefined;
  readonly bodyElements: number[][] | undefined;
}

function appendCell(options: CellOptions): void {
  const { cells, x, y, indices, elements, faces, bodyElements } = options;
  const side = cells + 1;
  const bottomLeft = y * side + x;
  const bottomRight = bottomLeft + 1;
  const topLeft = bottomLeft + side;
  const topRight = topLeft + 1;
  const cell = y * cells + x;
  const indexOffset = cell * 6;
  indices.set([bottomLeft, bottomRight, topRight, bottomLeft, topRight, topLeft], indexOffset);
  const elementId = cell + 1;
  const bodyId = bodyElements === undefined ? undefined : (cell % bodyElements.length) + 1;
  elements?.push({
    id: elementId,
    primitiveStart: cell * 2,
    primitiveCount: 2,
    ...(bodyId === undefined ? {} : { bodyId }),
  });
  bodyElements?.[bodyId === undefined ? 0 : bodyId - 1]?.push(elementId);
  const nodeIds = [bottomLeft, bottomRight, topRight, topLeft];
  const key = nodeIds
    .slice()
    .sort((a, b) => a - b)
    .join(":");
  faces?.push({
    elementId,
    faceIndex: 0,
    primitiveStart: cell * 2,
    primitiveCount: 2,
    key,
    nodeIds,
    neighborElementIds: [],
    ...(bodyId === undefined ? {} : { bodyId }),
  });
}

function createBodyElementLists(bodyCount: number | undefined): number[][] | undefined {
  return bodyCount === undefined ? undefined : Array.from({ length: bodyCount }, () => []);
}

function toBody(elementIds: readonly number[], index: number): Body {
  return { id: index + 1, name: `Body ${index + 1}`, elementIds };
}

function validateGridOptions(
  cells: number,
  bodyCount: number | undefined,
  elementMode: PlanarGridOptions["elementMode"],
): void {
  if (!Number.isInteger(cells) || cells < 1)
    throw new Error("grid cells must be a positive integer");
  if (bodyCount === undefined) return;
  if (elementMode === "aggregate") {
    throw new Error("body count requires cell elements");
  }
  if (!Number.isInteger(bodyCount) || bodyCount < 1 || bodyCount > cells * cells) {
    throw new Error("body count must be a positive integer no greater than the element count");
  }
}
