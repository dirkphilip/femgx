import { describe, expect, it } from "vitest";
import { TriangleMeshAssembler, type MeshVertex } from "../../src/geometry/mesh-builder";

const vertex = (nodeId: number, point: readonly [number, number, number]): MeshVertex => ({
  nodeId,
  point,
});

describe("TriangleMeshAssembler", () => {
  it("reuses explicit authored node identities across triangle faces", () => {
    const assembler = new TriangleMeshAssembler();
    assembler.append([vertex(10, [0, 0, 0]), vertex(11, [1, 0, 0]), vertex(12, [1, 1, 0])]);
    assembler.append([vertex(10, [0, 0, 0]), vertex(12, [1, 1, 0]), vertex(13, [0, 1, 0])]);

    const geometry = assembler.build("triangles");
    expect(Array.from(geometry.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(geometry.positions.length / 3).toBe(4);
    expect(geometry.nodePickIds).toEqual(new Uint32Array([11, 12, 13, 14]));
  });

  it("does not weld coincident positions with different source identities", () => {
    const assembler = new TriangleMeshAssembler();
    const first = vertex(1, [0, 0, 0]);
    const second = vertex(2, [1, 0, 0]);
    const third = vertex(3, [0, 1, 0]);
    assembler.append([first, second, third]);
    assembler.append([vertex(4, [0, 0, 0]), vertex(5, [1, 0, 0]), vertex(6, [0, 1, 0])]);

    const geometry = assembler.build("triangles");
    expect(geometry.positions.length / 3).toBe(6);
    expect(Array.from(geometry.indices)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("supports explicit generated identityMatrix while keeping anonymous corners distinct", () => {
    const assembler = new TriangleMeshAssembler();
    const shared: MeshVertex = { point: [0, 0, 0], nodeId: undefined, sourceId: "shared" };
    const anonymous: MeshVertex = { point: [1, 0, 0], nodeId: undefined };
    const end: MeshVertex = { point: [0, 1, 0], nodeId: undefined };
    assembler.append([shared, anonymous, end]);
    assembler.append([shared, anonymous, end]);

    const geometry = assembler.build("triangles");
    expect(geometry.positions.length / 3).toBe(5);
    expect(Array.from(geometry.indices)).toEqual([0, 1, 2, 0, 3, 4]);
  });

  it("copies assembled buffers away from source inputs", () => {
    const assembler = new TriangleMeshAssembler();
    const points = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ] as const;
    assembler.append([vertex(1, points[0]), vertex(2, points[1]), vertex(3, points[2])]);
    const geometry = assembler.build("triangles");

    assembler.positions[0] = 99;
    assembler.indices[0] = 2;
    expect(Array.from(geometry.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(geometry.indices)).toEqual([0, 1, 2]);
  });
});
