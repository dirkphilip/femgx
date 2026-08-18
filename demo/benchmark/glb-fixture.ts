/** Builds one self-contained GLB containing many independent triangle primitives. */
export function makeManyPrimitiveGlb(primitiveCount: number): Uint8Array<ArrayBuffer> {
  const positions = new Float32Array(primitiveCount * 9);
  const columns = Math.ceil(Math.sqrt(primitiveCount));
  for (let primitive = 0; primitive < primitiveCount; primitive += 1) {
    const x = primitive % columns;
    const y = Math.floor(primitive / columns);
    positions.set([x, y, 0, x + 0.8, y, 0, x, y + 0.8, 0], primitive * 9);
  }
  const binary = new Uint8Array(positions.buffer);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        name: "Many primitives",
        primitives: Array.from({ length: primitiveCount }, (_, index) => ({
          attributes: { POSITION: index },
        })),
      },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: Array.from({ length: primitiveCount }, (_, index) => ({
      buffer: 0,
      byteOffset: index * 9 * Float32Array.BYTES_PER_ELEMENT,
      byteLength: 9 * Float32Array.BYTES_PER_ELEMENT,
    })),
    accessors: Array.from({ length: primitiveCount }, (_, index) => ({
      bufferView: index,
      componentType: 5126,
      count: 3,
      type: "VEC3",
    })),
  };
  return makeGlb(json, binary);
}

/** Builds one GLB scene containing many single-primitive meshes in a flat node list. */
export function makeManyPartGlb(partCount: number): Uint8Array<ArrayBuffer> {
  const positions = new Float32Array([0, 0, 0, 0.8, 0, 0, 0, 0.8, 0]);
  const binary = new Uint8Array(positions.buffer);
  const columns = Math.ceil(Math.sqrt(partCount));
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: Array.from({ length: partCount }, (_, index) => index) }],
    nodes: Array.from({ length: partCount }, (_, index) => ({
      mesh: index,
      translation: [index % columns, Math.floor(index / columns), 0],
    })),
    meshes: Array.from({ length: partCount }, () => ({
      primitives: [{ attributes: { POSITION: 0 } }],
    })),
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
  };
  return makeGlb(json, binary);
}

/** Builds a Mechanical Assembly Web-shaped GLB with one colored mesh per leaf node. */
export function makeMechanicalAssemblyGlb(partCount: number): Uint8Array<ArrayBuffer> {
  const verticesPerPart = 30;
  const trianglesPerPart = 56;
  const positionBytes = verticesPerPart * 3 * Float32Array.BYTES_PER_ELEMENT;
  const indexBytes = trianglesPerPart * 3 * Uint32Array.BYTES_PER_ELEMENT;
  const partBytes = positionBytes + indexBytes;
  const binary = new Uint8Array(partCount * partBytes);
  const templatePositions = mechanicalPartPositions(verticesPerPart);
  const templateIndices = mechanicalPartIndices(verticesPerPart, trianglesPerPart);
  const positionSource = new Uint8Array(templatePositions.buffer);
  const indexSource = new Uint8Array(templateIndices.buffer);
  for (let part = 0; part < partCount; part += 1) {
    const offset = part * partBytes;
    binary.set(positionSource, offset);
    binary.set(indexSource, offset + positionBytes);
  }
  const columns = Math.ceil(Math.sqrt(partCount));
  const json = {
    asset: { version: "2.0", generator: "Mechanical Assembly Web benchmark" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "Assembly", children: Array.from({ length: partCount }, (_, index) => index + 1) },
      ...Array.from({ length: partCount }, (_, index) => ({
        name: `Part ${index}`,
        mesh: index,
        translation: [index % columns, Math.floor(index / columns), 0],
      })),
    ],
    meshes: Array.from({ length: partCount }, (_, index) => ({
      primitives: [
        { attributes: { POSITION: index * 2 }, indices: index * 2 + 1, material: index },
      ],
    })),
    materials: Array.from({ length: partCount }, (_, index) => ({
      pbrMetallicRoughness: { baseColorFactor: mechanicalPartColor(index, partCount) },
    })),
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: Array.from({ length: partCount * 2 }, (_, index) => {
      const part = Math.floor(index / 2);
      const positions = index % 2 === 0;
      return {
        buffer: 0,
        byteOffset: part * partBytes + (positions ? 0 : positionBytes),
        byteLength: positions ? positionBytes : indexBytes,
      };
    }),
    accessors: Array.from({ length: partCount * 2 }, (_, index) => ({
      bufferView: index,
      componentType: index % 2 === 0 ? 5126 : 5125,
      count: index % 2 === 0 ? verticesPerPart : trianglesPerPart * 3,
      type: index % 2 === 0 ? "VEC3" : "SCALAR",
    })),
  };
  return makeGlb(json, binary);
}

function mechanicalPartPositions(vertexCount: number): Float32Array<ArrayBuffer> {
  const positions = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const angle = (vertex / vertexCount) * Math.PI * 2;
    positions.set([Math.cos(angle) * 0.4, Math.sin(angle) * 0.4, (vertex % 3) * 0.1], vertex * 3);
  }
  return positions;
}

function mechanicalPartIndices(
  vertexCount: number,
  triangleCount: number,
): Uint32Array<ArrayBuffer> {
  const indices = new Uint32Array(triangleCount * 3);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    indices.set(
      [0, (triangle % (vertexCount - 1)) + 1, ((triangle + 1) % (vertexCount - 1)) + 1],
      triangle * 3,
    );
  }
  return indices;
}

function mechanicalPartColor(
  index: number,
  partCount: number,
): readonly [number, number, number, 1] {
  return [
    (index + 1) / (partCount + 1),
    ((index * 17) % partCount) / partCount,
    ((index * 97) % partCount) / partCount,
    1,
  ];
}

function makeGlb(json: object, binary: Uint8Array): Uint8Array<ArrayBuffer> {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (jsonBytes.byteLength + 3) & ~3;
  const binaryLength = (binary.byteLength + 3) & ~3;
  const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
  const result = new Uint8Array(totalLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.set(jsonBytes, 20);
  result.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  result.set(binary, binaryHeader + 8);
  return result;
}
