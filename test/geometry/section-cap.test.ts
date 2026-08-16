import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  PYRAMID5_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  WEDGE6_SHAPE,
  type ElementShape,
} from "../../src/elements/shapes";
import { elementPart } from "../../src/geometry/element-part";
import { buildElementSectionCap, type SectionCap } from "../../src/geometry/section-cap";
import { identity, translation } from "../../src/math/mat4";
import { GOLDEN_ELEMENT_CONVENTIONS } from "../elements/golden";

function conventionFor(shape: ElementShape) {
  const convention = GOLDEN_ELEMENT_CONVENTIONS.find((candidate) => candidate.shape === shape);
  if (convention === undefined)
    throw new Error(`missing golden for ${shape.family}:${shape.order}`);
  return convention;
}

function nodesFor(shape: ElementShape): number[] {
  return conventionFor(shape).reference.flatMap((point) => point);
}

const idsFor = (shape: ElementShape): number[] =>
  Array.from({ length: conventionFor(shape).nodeCount }, (_, index) => index);

function capFor(shape: ElementShape, plane = 0.5): SectionCap {
  const model = createElementModel(nodesFor(shape), [createElement(7, shape, idsFor(shape))]);
  const part = elementPart(1, model);
  const element = part.elements?.[0];
  if (element === undefined) throw new Error("missing test element");
  const cap = buildElementSectionCap({
    part,
    element,
    plane: { normal: [0, 0, 1], distance: -plane },
    transform: identity(),
  });
  if (cap === undefined) throw new Error(`expected a cap for ${shape.family}:${shape.order}`);
  return cap;
}

describe("canonical FE section cap builder", () => {
  it.each([
    ["Tet4", TET4_SHAPE, 3],
    ["Tet10", TET10_SHAPE, 3],
    ["Wedge6", WEDGE6_SHAPE, 3],
    ["Pyramid5", PYRAMID5_SHAPE, 4],
    ["Hex8", HEX8_SHAPE, 4],
    ["Hex20", HEX20_SHAPE, 4],
  ] as const)("builds one wound polygon for %s", (_name, shape, vertexCount) => {
    const cap = capFor(shape);
    expect(cap.vertices).toHaveLength(vertexCount);
    expect(cap.indices).toHaveLength((vertexCount - 2) * 3);
    expect(cap.vertices.every((vertex) => vertex.position[2] === 0.5)).toBe(true);
    for (let index = 0; index < cap.indices.length; index += 3) {
      const a = cap.vertices[cap.indices[index] ?? 0]?.position ?? [0, 0, 0];
      const b = cap.vertices[cap.indices[index + 1] ?? 0]?.position ?? [0, 0, 0];
      const c = cap.vertices[cap.indices[index + 2] ?? 0]?.position ?? [0, 0, 0];
      const normal = [
        (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
        (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
      ];
      expect(normal[2]).toBeLessThan(0);
    }
  });

  it("drops tangent contact and unsupported surface elements", () => {
    const model = createElementModel(nodesFor(HEX8_SHAPE), [
      createElement(7, HEX8_SHAPE, idsFor(HEX8_SHAPE)),
    ]);
    const part = elementPart(1, model);
    const element = part.elements?.[0];
    if (element === undefined) throw new Error("missing test element");
    expect(
      buildElementSectionCap({
        part,
        element,
        plane: { normal: [0, 0, 1], distance: -2 },
        transform: identity(),
      }),
    ).toBeUndefined();
    expect(
      buildElementSectionCap({
        part,
        element,
        plane: { normal: [0, 0, 1], distance: 0 },
        transform: identity(),
      }),
    ).toBeUndefined();

    const surface = createElementModel(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [createElement(7, { family: "triangle", order: 1 }, [0, 1, 2])],
    );
    const surfacePart = elementPart(2, surface);
    expect(
      buildElementSectionCap({
        part: surfacePart,
        element: surfacePart.elements?.[0] as NonNullable<typeof surfacePart.elements>[number],
        plane: { normal: [0, 0, 1], distance: 0 },
        transform: identity(),
      }),
    ).toBeUndefined();
  });

  it("applies occurrence transforms and authored nodal deformation before the plane", () => {
    const model = createElementModel(nodesFor(HEX8_SHAPE), [
      createElement(7, HEX8_SHAPE, idsFor(HEX8_SHAPE)),
    ]);
    const part = elementPart(1, model);
    const element = part.elements?.[0];
    if (element === undefined) throw new Error("missing test element");
    const cap = buildElementSectionCap({
      part,
      element,
      plane: { normal: [1, 0, 0], distance: -2.75 },
      transform: translation(2, 3, 4),
      displacements: new Float32Array(
        nodesFor(HEX8_SHAPE).map((_, index) => (index % 3 === 0 ? 0.25 : 0)),
      ),
      deformationScale: 1,
    });
    expect(cap?.vertices).toHaveLength(4);
    expect(cap?.vertices.every((vertex) => vertex.position[0] === 2.75)).toBe(true);
    expect(
      cap?.vertices.every((vertex) => vertex.position[1] >= 3 && vertex.position[1] <= 4),
    ).toBe(true);
  });

  it("retains endpoint weights for nodal interpolation at edge crossings", () => {
    const cap = capFor(HEX8_SHAPE);
    const edge = cap.vertices.find(
      (vertex) =>
        (vertex.nodeA === 0 && vertex.nodeB === 4) || (vertex.nodeA === 4 && vertex.nodeB === 0),
    );
    expect(edge).toMatchObject({ nodeA: 0, nodeB: 4, weightB: 0.5 });
  });
});
