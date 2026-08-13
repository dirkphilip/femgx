import { describe, expect, it } from "vitest";
import { createElement, type Element } from "../../src/elements/element";
import {
  createElementModel,
  type Body,
  type ElementModelOptions,
  ElementModelValidationError,
} from "../../src/elements/model";
import { LINE_SHAPE, TRIANGLE_SHAPE } from "../../src/elements/shapes";

const nodes = [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0];
const elements: readonly Element[] = [
  createElement(1, TRIANGLE_SHAPE, [0, 1, 2]),
  createElement(2, LINE_SHAPE, [2, 3]),
];

function model(options: ElementModelOptions = {}, sourceElements: readonly Element[] = elements) {
  return createElementModel(nodes, sourceElements, options);
}

function expectCode(options: ElementModelOptions, code: string, sourceElements = elements): void {
  expect(() => model(options, sourceElements)).toThrow(
    expect.objectContaining({ name: "ElementModelValidationError", code }),
  );
}

describe("createElementModel authored grouping", () => {
  it("keeps direct bodies as the blockless common path", () => {
    const direct = model({ bodies: [{ id: 4, name: "surface", elementIds: [1] }] });

    expect(direct.blocks).toBeUndefined();
    expect(direct.bodies).toEqual([{ id: 4, name: "surface", elementIds: [1] }]);
  });

  it("accepts mixed-family blocks aggregated by one body", () => {
    const authored = model({
      blocks: [{ id: 10, name: "property region", elementIds: [1, 2] }],
      bodies: [{ id: 20, blockIds: [10] }],
    });

    expect(authored.blocks).toEqual([
      {
        id: 10,
        name: "property region",
        elementIds: [1, 2],
      },
    ]);
    expect(authored.bodies).toEqual([{ id: 20, blockIds: [10] }]);
  });

  it("copies authored arrays so later host mutation cannot alter the model", () => {
    const block = { id: 10, elementIds: [1, 2] };
    const body = { id: 20, blockIds: [10] };
    const authored = model({ blocks: [block], bodies: [body] });

    expect(authored.blocks?.[0]?.elementIds).not.toBe(block.elementIds);
    expect(authored.bodies?.[0]).not.toBe(body);
    block.elementIds[0] = 2;
    body.blockIds[0] = 11;
    expect(authored.blocks?.[0]?.elementIds).toEqual([1, 2]);
    expect(authored.bodies).toEqual([{ id: 20, blockIds: [10] }]);
  });

  it.each([
    ["invalid-block-id", { blocks: [{ id: 0, elementIds: [1] }] }],
    [
      "duplicate-block-id",
      {
        blocks: [
          { id: 10, elementIds: [1] },
          { id: 10, elementIds: [2] },
        ],
      },
    ],
    [
      "block-order",
      {
        blocks: [
          { id: 11, elementIds: [1] },
          { id: 10, elementIds: [2] },
        ],
      },
    ],
    ["empty-block", { blocks: [{ id: 10, elementIds: [] }] }],
    ["unknown-block-element", { blocks: [{ id: 10, elementIds: [3] }] }],
    [
      "duplicate-block-membership",
      {
        blocks: [
          { id: 10, elementIds: [1] },
          { id: 11, elementIds: [1] },
        ],
      },
    ],
  ] as const)("rejects invalid block state: %s", (code, options) => {
    expectCode(options, code);
  });

  it("rejects duplicate element identities", () => {
    const first = elements[0];
    if (first === undefined) throw new Error("test element is missing");
    expectCode({}, "duplicate-element-id", [first, first]);
  });

  it.each([
    [
      "body-membership-form",
      { bodies: [{ id: 20, elementIds: [1], blockIds: [10] } as unknown as Body] },
    ],
    ["body-membership-form", { bodies: [{ id: 20 } as unknown as Body] }],
    ["invalid-body-id", { bodies: [{ id: 0, elementIds: [1] }] }],
    ["empty-body", { bodies: [{ id: 20, elementIds: [] }] }],
    ["unknown-body-element", { bodies: [{ id: 20, elementIds: [3] }] }],
    ["unknown-body-block", { bodies: [{ id: 20, blockIds: [10] }] }],
    [
      "duplicate-body-membership",
      {
        bodies: [
          { id: 20, elementIds: [1] },
          { id: 21, elementIds: [1] },
        ],
      },
    ],
    [
      "block-body-mismatch",
      {
        blocks: [{ id: 10, elementIds: [1] }],
        bodies: [
          { id: 20, elementIds: [1] },
          { id: 21, blockIds: [10] },
        ],
      },
    ],
  ] as const)("rejects invalid body state: %s", (code, options) => {
    expectCode(options, code);
  });

  it("uses a typed domain error for forbidden authored states", () => {
    try {
      model({ blocks: [{ id: 10, elementIds: [1, 1] }] });
      throw new Error("expected model validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ElementModelValidationError);
      expect((error as ElementModelValidationError).code).toBe("block-order");
    }
  });
});
