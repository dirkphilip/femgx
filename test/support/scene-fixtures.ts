import { createPart, type Part } from "../../src/geometry/part";

/** Creates the minimal empty triangle part used by scene identity tests. */
export function emptyPart(id: number): Part {
  return createPart(id, {
    geometries: [
      {
        positions: new Float32Array([0, 0, 0]),
        indices: new Uint32Array(),
        primitive: "triangles",
      },
    ],
  });
}
