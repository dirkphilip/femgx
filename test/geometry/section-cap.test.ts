import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import { ElementShape } from "../../src/elements/shapes";
import { createPartFromElementModel } from "../../src/geometry/element-model-part";
import { buildElementSectionCap, type SectionCap } from "../../src/geometry/section-cap";
import { identityMatrix, translationMatrix } from "../../src/math/mat4";
import { GOLDEN_ELEMENT_CONVENTIONS } from "../elements/golden";

function conventionFor(shape: ElementShape) {
  const convention = GOLDEN_ELEMENT_CONVENTIONS.find((candidate) => candidate.shape === shape);
  if (convention === undefined) throw new Error(`missing golden for ${shape}`);
  return convention;
}

function nodesFor(shape: ElementShape): number[] {
  return conventionFor(shape).reference.flatMap((point) => point);
}

const idsFor = (shape: ElementShape): number[] =>
  Array.from({ length: conventionFor(shape).nodeCount }, (_, index) => index);

function capFor(shape: ElementShape, plane = 0.5): SectionCap {
  const model = createElementModel(nodesFor(shape), [createElement(7, shape, idsFor(shape))]);
  const part = createPartFromElementModel(1, model);
  const element = part.elements?.at(0);
  if (element === undefined) throw new Error("missing test element");
  const cap = buildElementSectionCap({
    part,
    element,
    plane: { normal: [0, 0, 1], distance: -plane },
    transform: identityMatrix(),
  });
  if (cap === undefined) throw new Error(`expected a cap for ${shape}`);
  return cap;
}

describe("canonical FE section cap builder", () => {
  it.each([
    ["Tet4", ElementShape.Tet4, 3],
    ["Tet10", ElementShape.Tet10, 3],
    ["Wedge6", ElementShape.Wedge6, 3],
    ["Pyramid5", ElementShape.Pyramid5, 4],
    ["Hex8", ElementShape.Hex8, 4],
    ["Hex20", ElementShape.Hex20, 4],
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
    const model = createElementModel(nodesFor(ElementShape.Hex8), [
      createElement(7, ElementShape.Hex8, idsFor(ElementShape.Hex8)),
    ]);
    const part = createPartFromElementModel(1, model);
    const element = part.elements?.at(0);
    if (element === undefined) throw new Error("missing test element");
    expect(
      buildElementSectionCap({
        part,
        element,
        plane: { normal: [0, 0, 1], distance: -2 },
        transform: identityMatrix(),
      }),
    ).toBeUndefined();
    expect(
      buildElementSectionCap({
        part,
        element,
        plane: { normal: [0, 0, 1], distance: 0 },
        transform: identityMatrix(),
      }),
    ).toBeUndefined();

    const surface = createElementModel(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [createElement(7, ElementShape.Triangle, [0, 1, 2])],
    );
    const createPartFromExplicitTopology = createPartFromElementModel(2, surface);
    const surfaceElement = createPartFromExplicitTopology.elements?.at(0);
    if (surfaceElement === undefined) throw new Error("missing surface test element");
    expect(
      buildElementSectionCap({
        part: createPartFromExplicitTopology,
        element: surfaceElement,
        plane: { normal: [0, 0, 1], distance: 0 },
        transform: identityMatrix(),
      }),
    ).toBeUndefined();
  });

  it("applies occurrence transforms and authored nodal deformation before the plane", () => {
    const model = createElementModel(nodesFor(ElementShape.Hex8), [
      createElement(7, ElementShape.Hex8, idsFor(ElementShape.Hex8)),
    ]);
    const part = createPartFromElementModel(1, model);
    const element = part.elements?.at(0);
    if (element === undefined) throw new Error("missing test element");
    const cap = buildElementSectionCap({
      part,
      element,
      plane: { normal: [1, 0, 0], distance: -2.75 },
      transform: translationMatrix(2, 3, 4),
      displacements: new Float32Array(
        nodesFor(ElementShape.Hex8).map((_, index) => (index % 3 === 0 ? 0.25 : 0)),
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
    const cap = capFor(ElementShape.Hex8);
    const edge = cap.vertices.find(
      (vertex) =>
        (vertex.nodeA === 0 && vertex.nodeB === 4) || (vertex.nodeA === 4 && vertex.nodeB === 0),
    );
    expect(edge).toMatchObject({ nodeA: 0, nodeB: 4, weightB: 0.5 });
  });
});
