import { describe, expect, it } from "vitest";
import { createElement, type Element } from "../../src/elements/element";
import {
  createElementModel,
  elementModelMembership,
  type ElementModelOptions,
  ElementModelValidationError,
} from "../../src/elements/model";
import { elementModelStorage } from "../../src/elements/model-storage";
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
  it("keeps descriptors query-only over one canonical typed representation", () => {
    const authored = model();

    expect(Array.isArray(authored.elements)).toBe(false);
    expect(authored.elements.count).toBe(2);
    expect(authored.elements.at(0)).not.toBe(authored.elements.at(0));
    expect(authored.elements.get(2)?.nodeIds).toEqual([2, 3]);
  });

  it("keeps direct bodies as the only authored grouping", () => {
    const direct = model({ bodies: [{ id: 4, name: "surface", elementIds: [1] }] });

    expect(Array.isArray(direct.bodies)).toBe(false);
    expect([...(direct.bodies ?? [])]).toEqual([{ id: 4, name: "surface", elementIds: [1] }]);
    expect(elementModelMembership(direct).bodyIdForElement(1)).toBe(4);
  });

  it("copies authored arrays so later host mutation cannot alter the model", () => {
    const body = { id: 20, elementIds: [1] };
    const authored = model({ bodies: [body] });

    expect(authored.bodies?.at(0)).not.toBe(body);
    expect(authored.bodies?.at(0)?.elementIds).not.toBe(body.elementIds);
    body.elementIds[0] = 2;
    expect([...(authored.bodies ?? [])]).toEqual([{ id: 20, elementIds: [1] }]);
  });

  it("materializes equal but independent frozen body records from typed columns", () => {
    const authored = model({ bodies: [{ id: 20, name: "shell", elementIds: [1] }] });
    const first = authored.bodies?.get(20);
    const second = authored.bodies?.at(0);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.elementIds)).toBe(true);
    const storage = elementModelStorage(authored);
    expect(storage.bodyIds).toBeInstanceOf(Uint32Array);
    expect(storage.bodyIdOrdinals).toBeInstanceOf(Uint32Array);
    expect(storage.bodyNameDefined).toBeInstanceOf(Uint8Array);
    expect(storage.bodyNameOffsets).toBeInstanceOf(Uint32Array);
    expect(storage.bodyNameText).toBeInstanceOf(Uint16Array);
    expect(storage.bodyElementOffsets).toBeInstanceOf(Uint32Array);
    expect(storage.bodyElementOrdinals).toBeInstanceOf(Uint32Array);
  });

  it("has no direct body ownership when bodies are omitted", () => {
    const direct = model();
    expect(direct.bodies).toBeUndefined();
    expect(elementModelMembership(direct).bodyIdForElement(1)).toBeUndefined();
    expect(elementModelStorage(direct).bodyIds).toBeUndefined();
  });

  it("resolves sparse body ids without max-id storage", () => {
    const direct = model({ bodies: [{ id: 0xffff_fffe, elementIds: [1] }] });

    expect(direct.bodies?.get(0xffff_fffe)?.id).toBe(0xffff_fffe);
    expect(elementModelStorage(direct).bodyIds).toHaveLength(1);
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
