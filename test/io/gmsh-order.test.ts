import { describe, expect, it } from "vitest";
import {
  canonicalElementCoordinates,
  canonicalElementModel,
  coordsOfModel,
  expectMidEdgePlacement,
  required,
} from "./helpers";
import { parseGmsh, writeGmsh } from "../../src/io/parse";
import {
  canonicalToGmshOrder,
  gmshToCanonicalOrder,
  permuteConnectivity,
} from "../../src/io/gmsh-order";
import { HEX20_SHAPE, TET10_SHAPE, type ElementShape } from "../../src/elements/shapes";

const GMSH_TYPE: ReadonlyMap<string, number> = new Map([
  ["tet:2", 11],
  ["hex:2", 17],
]);

/** Assembles an ASCII MSH 2.2 file from slot-ordered node coordinates and connectivity. */
function mshSource(shape: ElementShape, connectivity: readonly number[]): string {
  const coords = canonicalElementCoordinates(shape);
  const nodeCount = coords.length / 3;
  const lines = ["$MeshFormat", "2.2 0 8", "$EndMeshFormat", "$Nodes", String(nodeCount)];
  for (let node = 0; node < nodeCount; node += 1) {
    lines.push(
      `${String(node)} ${String(coords[3 * node])} ${String(coords[3 * node + 1])} ${String(
        coords[3 * node + 2],
      )}`,
    );
  }
  lines.push("$Elements", "1");
  lines.push(
    `1 ${String(GMSH_TYPE.get(`${shape.family}:${shape.order}`) ?? 0)} 0 ${connectivity.join(" ")}`,
  );
  lines.push("$EndElements");
  return lines.join("\n");
}

describe("gmsh node orderings", () => {
  it("translates tet10 with only the last two mid-edge slots swapped", () => {
    const toCanonical = required(gmshToCanonicalOrder(TET10_SHAPE));
    const toGmsh = required(canonicalToGmshOrder(TET10_SHAPE));
    expect([...toCanonical]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9, 8]);
    expect([...toGmsh]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9, 8]);
  });

  it("translates hex20 with the meshio gmsh-to-VTK permutation", () => {
    const toCanonical = required(gmshToCanonicalOrder(HEX20_SHAPE));
    expect([...toCanonical]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 13, 9, 16, 18, 19, 17, 10, 12, 14, 15,
    ]);
    const toGmsh = required(canonicalToGmshOrder(HEX20_SHAPE));
    expect([...toGmsh]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 16, 9, 17, 10, 18, 19, 12, 15, 13, 14,
    ]);
  });

  it("returns undefined for shapes gmsh orders identically to canonical", () => {
    expect(canonicalToGmshOrder({ family: "tet", order: 1 })).toBeUndefined();
    expect(canonicalToGmshOrder({ family: "hex", order: 1 })).toBeUndefined();
    expect(canonicalToGmshOrder({ family: "line", order: 2 })).toBeUndefined();
  });

  it("permuteConnectivity applies a permutation in place of a connectivity array", () => {
    expect(permuteConnectivity([10, 20, 30, 40], [0, 3, 1, 2])).toEqual([10, 40, 20, 30]);
  });
});

describe("gmsh quadratic round-trips", () => {
  it.each([
    ["Tet10", TET10_SHAPE],
    ["Hex20", HEX20_SHAPE],
  ] as const)("writes and re-reads %s mid-edge nodes on their canonical edges", (_name, shape) => {
    const { model, coordsOf } = canonicalElementModel(shape);
    const parsed = parseGmsh(writeGmsh(model));
    expect(parsed.issues).toEqual([]);
    const block = required(parsed.model.elementBlocks[0]);
    expect(block.shape.family).toBe(shape.family);
    expect(block.shape.order).toBe(shape.order);
    expect([...block.connectivity]).toEqual([...required(model.elementBlocks[0]).connectivity]);
    expectMidEdgePlacement(block, coordsOf);
  });

  it("reads a native gmsh-ordered hex20 into canonical node order", () => {
    const { model } = canonicalElementModel(HEX20_SHAPE);
    const block = required(model.elementBlocks[0]);
    const toGmsh = required(canonicalToGmshOrder(HEX20_SHAPE));
    const nativeConnectivity = [...toGmsh].map((slot) => block.connectivity[slot] ?? 0);
    const parsed = parseGmsh(mshSource(HEX20_SHAPE, nativeConnectivity));
    expect(parsed.issues).toEqual([]);
    expect([...required(parsed.model.elementBlocks[0]).connectivity]).toEqual([
      ...block.connectivity,
    ]);
    expectMidEdgePlacement(required(parsed.model.elementBlocks[0]), coordsOfModel(parsed.model));
  });
});
