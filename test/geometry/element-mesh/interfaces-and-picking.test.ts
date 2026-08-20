import { describe, expect, it } from "vitest";
import {
  TET_NODES,
  tet4Model,
  hex8Model,
  hex20Model,
  sharedTetPairModel,
  geometryFor,
  ElementShape,
  validateElements,
  deformGeometry,
  createResultField,
} from "./support";

describe("createPartFromElementModel geometry", () => {
  it("retains the shared face between two tets for GPU visibility", () => {
    const model = sharedTetPairModel();
    const geometry = geometryFor(model, "triangle");
    expect(geometry.indices.length).toBe(8 * 3);
    expect(geometry.positions.length / 3).toBe(5);
  });

  it("retains both oriented cross-body interface faces", () => {
    const geometry = geometryFor(sharedTetPairModel(), "triangle", {
      bodies: [
        { id: 1, elementIds: [1] },
        { id: 2, elementIds: [2] },
      ],
    });
    const interfaces = Array.from(geometry.faces ?? []).filter(
      (face) => face.neighborElementId !== undefined,
    );
    expect(interfaces).toHaveLength(2);
    expect(interfaces.map((face) => [face.bodyId, face.neighborElementId])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(geometry.indices.length).toBe(8 * 3);
  });

  it("retains same-body and named/unowned interfaces for GPU visibility", () => {
    const model = sharedTetPairModel();
    const sameBody = geometryFor(model, "triangle", {
      bodies: [{ id: 1, elementIds: [1, 2] }],
    });
    expect(sameBody.indices.length).toBe(8 * 3);
    expect(Array.from(sameBody.faces ?? []).some((face) => face.neighborElementId !== undefined)).toBe(true);

    const namedAndUnowned = geometryFor(model, "triangle", {
      bodies: [{ id: 1, elementIds: [1] }],
    });
    expect(namedAndUnowned.indices.length).toBe(8 * 3);
    expect(Array.from(namedAndUnowned.faces ?? []).some((face) => face.neighborElementId !== undefined)).toBe(true);
  });

  it("records element tessellations so every triangle is element-pickable", () => {
    const hex = geometryFor(hex8Model(), "triangle");
    expect([...(hex.part.elements ?? [])]).toEqual([
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 12 }],
        shape: ElementShape.Hex8,
      },
    ]);
    expect(() => {
      validateElements(hex, [...(hex.part.elements ?? [])]);
    }).not.toThrow();

    const solid = geometryFor(sharedTetPairModel(), "triangle");
    expect([...(solid.part.elements ?? [])]).toEqual([
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 4 }],
        shape: ElementShape.Tet4,
      },
      {
        id: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 4, primitiveCount: 4 }],
        shape: ElementShape.Tet4,
      },
    ]);
  });

  it("records per-vertex node pick ids and node positions", () => {
    const geometry = geometryFor(tet4Model(), "triangle");
    expect(geometry.part.nodePositions).toEqual(new Float32Array(TET_NODES));
    expect(geometry.nodePickIds?.length).toBe(geometry.positions.length / 3);
    const pickIds = geometry.nodePickIds;
    if (pickIds === undefined) throw new Error("expected node pick ids");
    expect(new Set(pickIds)).toEqual(new Set([1, 2, 3, 4]));
    expect(pickIds).not.toContain(0);
  });

  it("keeps Hex20 deformation attached to every authored tessellation vertex", () => {
    const geometry = geometryFor(hex20Model(), "triangle");
    const pickIds = geometry.nodePickIds;
    if (pickIds === undefined) throw new Error("expected node pick ids");
    const values = new Float32Array(20 * 3);
    for (let node = 0; node < 20; node += 1) {
      values[node * 3] = node / 10;
      values[node * 3 + 1] = node / 20;
      values[node * 3 + 2] = -node / 30;
    }
    const field = createResultField({
      id: "hex20-displacement",
      name: "Hex20 displacement",
      location: "nodal",
      shape: "vector",
      count: 20,
      unit: "mm",
      values,
    });
    const translationMatrix = createResultField({
      id: "hex20-translation",
      name: "Hex20 translation",
      location: "nodal",
      shape: "vector",
      count: 20,
      unit: "mm",
      values: new Float32Array(20 * 3).fill(0.25),
    });
    const translated = deformGeometry(geometry, translationMatrix);
    for (let offset = 0; offset < translated.positions.length; offset += 3) {
      expect(translated.positions[offset]).toBeCloseTo((geometry.positions[offset] ?? 0) + 0.25);
      expect(translated.positions[offset + 1]).toBeCloseTo(
        (geometry.positions[offset + 1] ?? 0) + 0.25,
      );
      expect(translated.positions[offset + 2]).toBeCloseTo(
        (geometry.positions[offset + 2] ?? 0) + 0.25,
      );
    }
    const deformed = deformGeometry(geometry, field);
    for (let vertex = 0; vertex < pickIds.length; vertex += 1) {
      const node = (pickIds[vertex] ?? 1) - 1;
      const base = vertex * 3;
      expect(deformed.positions[base]).toBeCloseTo(
        (geometry.positions[base] ?? 0) + (values[node * 3] ?? 0),
      );
      expect(deformed.positions[base + 1]).toBeCloseTo(
        (geometry.positions[base + 1] ?? 0) + (values[node * 3 + 1] ?? 0),
      );
      expect(deformed.positions[base + 2]).toBeCloseTo(
        (geometry.positions[base + 2] ?? 0) + (values[node * 3 + 2] ?? 0),
      );
    }
    expect(deformGeometry(geometry, field, 0).positions).toEqual(geometry.positions);
  });
});
