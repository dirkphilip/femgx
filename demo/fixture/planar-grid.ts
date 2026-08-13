import type {
  Body,
  ElementTessellation,
  FaceTessellation,
  TriangleGeometry,
} from "../../src/index";

export type PlanarGridElementFamily = "triangle" | "quad";

export interface PlanarGridOptions {
  readonly withFaces?: boolean;
  readonly bodyCount?: number;
  readonly elementFamily: PlanarGridElementFamily;
}

/** Builds one deterministic indexed planar grid for demo and benchmark owners. */
export function createPlanarGridGeometry(
  cells: number,
  options: PlanarGridOptions,
): TriangleGeometry {
  validateGridOptions(cells, options.bodyCount, options.elementFamily);
  const side = cells + 1;
  const positions = new Float32Array(side * side * 3);
  const indices = new Uint32Array(cells * cells * 6);
  const elements: ElementTessellation[] = [];
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
        elementFamily: options.elementFamily,
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
    elements,
    ...(faces === undefined ? {} : { faces }),
    ...(bodyElements === undefined ? {} : { bodies: bodyElements.map(toBody) }),
  };
}

interface CellOptions {
  readonly cells: number;
  readonly x: number;
  readonly y: number;
  readonly indices: Uint32Array;
  readonly elementFamily: PlanarGridElementFamily;
  readonly elements: ElementTessellation[];
  readonly faces: FaceTessellation[] | undefined;
  readonly bodyElements: number[][] | undefined;
}

function appendCell(options: CellOptions): void {
  const { cells, x, y, indices, elementFamily, elements, faces, bodyElements } = options;
  const side = cells + 1;
  const bottomLeft = y * side + x;
  const bottomRight = bottomLeft + 1;
  const topLeft = bottomLeft + side;
  const topRight = topLeft + 1;
  const cell = y * cells + x;
  const indexOffset = cell * 6;
  indices.set([bottomLeft, bottomRight, topRight, bottomLeft, topRight, topLeft], indexOffset);
  if (elementFamily === "quad") {
    const elementId = cell + 1;
    const bodyId = bodyIdForElement(elementId, bodyElements);
    elements.push({
      id: elementId,
      primitiveStart: cell * 2,
      primitiveCount: 2,
      ...(bodyId === undefined ? {} : { bodyId }),
    });
    appendFace({
      elementId,
      primitiveStart: cell * 2,
      primitiveCount: 2,
      nodeIds: [bottomLeft, bottomRight, topRight, topLeft],
      bodyId,
      faces,
    });
    addBodyElement(elementId, bodyId, bodyElements);
    return;
  }

  appendTriangleElement({
    elementId: cell * 2 + 1,
    primitiveStart: cell * 2,
    nodeIds: [bottomLeft, bottomRight, topRight],
    bodyElements,
    elements,
    faces,
  });
  appendTriangleElement({
    elementId: cell * 2 + 2,
    primitiveStart: cell * 2 + 1,
    nodeIds: [bottomLeft, topRight, topLeft],
    bodyElements,
    elements,
    faces,
  });
}

interface TriangleElementOptions {
  readonly elementId: number;
  readonly primitiveStart: number;
  readonly nodeIds: readonly number[];
  readonly bodyElements: number[][] | undefined;
  readonly elements: ElementTessellation[];
  readonly faces: FaceTessellation[] | undefined;
}

function appendTriangleElement(options: TriangleElementOptions): void {
  const { elementId, primitiveStart, nodeIds, bodyElements, elements, faces } = options;
  const bodyId = bodyIdForElement(elementId, bodyElements);
  elements.push({
    id: elementId,
    primitiveStart,
    primitiveCount: 1,
    ...(bodyId === undefined ? {} : { bodyId }),
  });
  appendFace({
    elementId,
    primitiveStart,
    primitiveCount: 1,
    nodeIds,
    bodyId,
    faces,
  });
  addBodyElement(elementId, bodyId, bodyElements);
}

interface FaceOptions {
  readonly elementId: number;
  readonly primitiveStart: number;
  readonly primitiveCount: number;
  readonly nodeIds: readonly number[];
  readonly bodyId: number | undefined;
  readonly faces: FaceTessellation[] | undefined;
}

function appendFace(options: FaceOptions): void {
  const { elementId, primitiveStart, primitiveCount, nodeIds, bodyId, faces } = options;
  faces?.push({
    elementId,
    faceIndex: 0,
    primitiveStart,
    primitiveCount,
    key: canonicalNodeKey(nodeIds),
    nodeIds,
    neighborElementIds: [],
    ...(bodyId === undefined ? {} : { bodyId }),
  });
}

function canonicalNodeKey(nodeIds: readonly number[]): string {
  return nodeIds
    .slice()
    .sort((a, b) => a - b)
    .join(":");
}

function bodyIdForElement(
  elementId: number,
  bodyElements: number[][] | undefined,
): number | undefined {
  return bodyElements === undefined ? undefined : ((elementId - 1) % bodyElements.length) + 1;
}

function addBodyElement(
  elementId: number,
  bodyId: number | undefined,
  bodyElements: number[][] | undefined,
): void {
  if (bodyId === undefined || bodyElements === undefined) return;
  bodyElements[bodyId - 1]?.push(elementId);
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
  elementFamily: string,
): void {
  if (!Number.isInteger(cells) || cells < 1)
    throw new Error("grid cells must be a positive integer");
  if (elementFamily !== "triangle" && elementFamily !== "quad") {
    throw new Error("planar grid element family must be triangle or quad");
  }
  if (bodyCount === undefined) return;
  const elementCount = cells * cells * (elementFamily === "triangle" ? 2 : 1);
  if (!Number.isInteger(bodyCount) || bodyCount < 1 || bodyCount > elementCount) {
    throw new Error("body count must be a positive integer no greater than the element count");
  }
}
