import { describe, expect, it } from "vitest";
import { createElement, type Element } from "../../src/elements/element";
import {
  createElementModel,
  elementModelMembership,
  type ElementModelOptions,
  ElementModelValidationError,
} from "../../src/elements/model";
import { ElementShape } from "../../src/elements/shapes";

const nodes = [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0];
const elements: readonly Element[] = [
  createElement(1, ElementShape.Triangle, [0, 1, 2]),
  createElement(2, ElementShape.Line, [2, 3]),
];

function model(options: ElementModelOptions = {}, sourceElements: readonly Element[] = elements) {
  return createElementModel(nodes, sourceElements, options);
}

function expectCode(options: ElementModelOptions, code: string, sourceElements = elements): void {
  expect(() => model(options, sourceElements)).toThrow(
    expect.objectContaining({ name: "ElementModelValidationError", code }),
  );
}

describe("createElementModel authored bodies", () => {
  it("keeps direct bodies as the only authored grouping", () => {
    const direct = model({ bodies: [{ id: 4, name: "surface", elementIds: [1] }] });

    expect(direct.bodies).toEqual([{ id: 4, name: "surface", elementIds: [1] }]);
    expect(elementModelMembership(direct).bodyByElement).toEqual(new Map([[1, 4]]));
  });

  it("copies authored arrays so later host mutation cannot alter the model", () => {
    const body = { id: 20, elementIds: [1] };
    const authored = model({ bodies: [body] });

    expect(authored.bodies?.[0]).not.toBe(body);
    expect(authored.bodies?.[0]?.elementIds).not.toBe(body.elementIds);
    body.elementIds[0] = 2;
    expect(authored.bodies).toEqual([{ id: 20, elementIds: [1] }]);
  });

  it("uses an empty membership map when bodies are omitted", () => {
    const direct = model();
    expect(direct.bodies).toBeUndefined();
    expect(elementModelMembership(direct).bodyByElement.size).toBe(0);
  });

  it.each([
    {
      code: "duplicate-element-id",
      options: {},
      sourceElements: elements.slice(0, 1).concat(elements.slice(0, 1)),
    },
    { code: "invalid-body-id", options: { bodies: [{ id: 0, elementIds: [1] }] } },
    { code: "empty-body", options: { bodies: [{ id: 20, elementIds: [] }] } },
    { code: "unknown-body-element", options: { bodies: [{ id: 20, elementIds: [3] }] } },
    {
      code: "duplicate-body-membership",
      options: {
        bodies: [
          { id: 20, elementIds: [1] },
          { id: 21, elementIds: [1] },
        ],
      },
    },
  ] satisfies readonly {
    readonly code: string;
    readonly options: ElementModelOptions;
    readonly sourceElements?: readonly Element[];
  }[])("rejects invalid authored state: $code", ({ code, options, sourceElements }) => {
    expectCode(options, code, sourceElements);
  });

  it("uses a typed domain error for forbidden authored states", () => {
    try {
      model({ bodies: [{ id: 10, elementIds: [1, 1] }] });
      throw new Error("expected model validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ElementModelValidationError);
      expect((error as ElementModelValidationError).code).toBe("body-order");
    }
  });
});
