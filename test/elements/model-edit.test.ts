import { describe, expect, it } from "vitest";
import { createElement, type Element } from "../../src/elements/element";
import {
  createElementModel,
  editElementModel,
  ElementModelEditError,
  type ElementModel,
} from "../../src/index";
import { TRIANGLE_SHAPE } from "../../src/elements/shapes";

const nodes = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 2, 0, 0, 2, 1, 0];
const elements: readonly Element[] = [
  createElement(1, TRIANGLE_SHAPE, [0, 1, 2]),
  createElement(2, TRIANGLE_SHAPE, [1, 3, 2]),
  createElement(3, TRIANGLE_SHAPE, [1, 4, 3]),
];

function model(options: Parameters<typeof createElementModel>[2] = {}): ElementModel {
  return createElementModel(nodes, elements, options);
}

function snapshot(value: ElementModel): unknown {
  return {
    nodes: [...value.nodes],
    elements: value.elements,
    blocks: value.blocks,
    bodies: value.bodies,
  };
}

describe("editElementModel", () => {
  it("returns the original model for an empty transaction", () => {
    const source = model();

    const outcome = editElementModel(source, () => undefined);

    expect(outcome.model).toBe(source);
    expect(outcome.report).toEqual({
      addedNodeIds: [],
      unusedNodeIds: [],
      addedElementIds: [],
      removedElementIds: [],
      retainedElementIds: [],
      addedBlockIds: [],
      removedBlockIds: [],
      retainedBlockIds: [],
      addedBodyIds: [],
      removedBodyIds: [],
      retainedBodyIds: [],
    });
  });

  it("merges blocks while preserving direct-body representation and element order", () => {
    const source = model({
      blocks: [
        { id: 10, name: "first", elementIds: [1] },
        { id: 20, name: "second", elementIds: [2] },
        { id: 30, elementIds: [3] },
      ],
      bodies: [{ id: 40, elementIds: [1, 2, 3] }],
    });
    const before = snapshot(source);

    const outcome = editElementModel(source, (edit) => {
      edit.mergeBlocks({ sourceIds: [10, 20], targetId: 10, targetName: "merged" });
    });

    expect(snapshot(source)).toEqual(before);
    expect(outcome.model.elements.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(outcome.model.blocks).toEqual([
      { id: 10, name: "merged", elementIds: [1, 2] },
      { id: 30, elementIds: [3] },
    ]);
    expect(outcome.model.bodies).toEqual([{ id: 40, elementIds: [1, 2, 3] }]);
    expect(outcome.report).toMatchObject({
      removedBlockIds: [20],
      retainedBlockIds: [10, 30],
      retainedElementIds: [1, 2, 3],
    });
  });

  it("requires explicit resolution for a cross-body merge", () => {
    const source = model({
      blocks: [
        { id: 10, elementIds: [1] },
        { id: 20, elementIds: [2] },
      ],
      bodies: [
        { id: 30, blockIds: [10] },
        { id: 40, blockIds: [20] },
      ],
    });
    const before = snapshot(source);

    expect(() =>
      editElementModel(source, (edit) => {
        edit.mergeBlocks({ sourceIds: [20], targetId: 10 });
      }),
    ).toThrow(
      expect.objectContaining({
        name: "ElementModelEditError",
        code: "body-conflict",
        operation: "mergeBlocks",
      }),
    );
    expect(snapshot(source)).toEqual(before);

    const outcome = editElementModel(source, (edit) => {
      edit.mergeBlocks({ sourceIds: [20], targetId: 10, bodyId: 30 });
    });
    expect(outcome.model.bodies).toEqual([{ id: 30, blockIds: [10] }]);
    expect(outcome.report.removedBodyIds).toEqual([40]);
  });

  it("removes elements without compacting nodes and reports newly unused nodes", () => {
    const source = model({
      blocks: [
        { id: 10, elementIds: [1] },
        { id: 20, elementIds: [2, 3] },
      ],
      bodies: [{ id: 30, elementIds: [1, 2, 3] }],
    });

    const outcome = editElementModel(source, (edit) => {
      edit.removeBlock(10);
    });

    expect(outcome.model.nodes).toHaveLength(source.nodes.length);
    expect(outcome.model.elements.map(({ id }) => id)).toEqual([2, 3]);
    expect(outcome.model.bodies).toEqual([{ id: 30, elementIds: [2, 3] }]);
    expect(outcome.report).toMatchObject({
      removedElementIds: [1],
      unusedNodeIds: [0],
      removedBlockIds: [10],
    });
  });

  it("makes the body policy explicit when dissolving a block-defined body", () => {
    const source = model({
      blocks: [
        { id: 10, elementIds: [1] },
        { id: 20, elementIds: [2, 3] },
      ],
      bodies: [{ id: 30, blockIds: [10, 20] }],
    });

    expect(() =>
      editElementModel(source, (edit) => {
        edit.dissolveBlock(10);
      }),
    ).toThrow(expect.objectContaining({ code: "dissolve-policy-required" }));
    const direct = editElementModel(source, (edit) => {
      edit.dissolveBlock(10, { bodyPolicy: "direct" });
    });
    expect(direct.model.blocks).toEqual([{ id: 20, elementIds: [2, 3] }]);
    expect(direct.model.bodies).toEqual([{ id: 30, elementIds: [1, 2, 3] }]);

    const unassigned = editElementModel(source, (edit) => {
      edit.dissolveBlock(10, { bodyPolicy: "unassigned" });
    });
    expect(unassigned.model.bodies).toEqual([{ id: 30, blockIds: [20] }]);
  });

  it("replaces a block with retained and appended topology", () => {
    const source = model({
      blocks: [{ id: 10, elementIds: [1, 2] }],
      bodies: [{ id: 20, elementIds: [1, 2] }],
    });
    const before = snapshot(source);

    const outcome = editElementModel(source, (edit) => {
      edit.replaceBlock(10, {
        elements: [elements[0] as Element, createElement(4, TRIANGLE_SHAPE, [6, 7, 8])],
        nodes: [2, 2, 0, 3, 2, 0, 2, 3, 0],
      });
    });

    expect(snapshot(source)).toEqual(before);
    expect([...outcome.model.nodes]).toHaveLength(nodes.length + 9);
    expect(outcome.model.elements.map(({ id }) => id)).toEqual([1, 4, 3]);
    expect(outcome.model.blocks).toEqual([{ id: 10, elementIds: [1, 4] }]);
    expect(outcome.model.bodies).toEqual([{ id: 20, elementIds: [1, 4] }]);
    expect(outcome.report).toMatchObject({
      addedNodeIds: [6, 7, 8],
      unusedNodeIds: [],
      addedElementIds: [4],
      removedElementIds: [2],
      retainedElementIds: [1, 3],
    });
  });

  it("does not expose a partial result when a later operation fails", () => {
    const source = model({
      blocks: [
        { id: 10, elementIds: [1] },
        { id: 20, elementIds: [2, 3] },
      ],
    });
    const before = snapshot(source);

    expect(() =>
      editElementModel(source, (edit) => {
        edit.removeBlock(10);
        edit.removeBlock(10);
      }),
    ).toThrow(ElementModelEditError);
    expect(snapshot(source)).toEqual(before);
  });

  it("lets later operations observe the committed draft from earlier operations", () => {
    const source = model({
      blocks: [
        { id: 10, elementIds: [1] },
        { id: 20, elementIds: [2] },
        { id: 30, elementIds: [3] },
      ],
      bodies: [{ id: 40, elementIds: [1, 2, 3] }],
    });

    const outcome = editElementModel(source, (edit) => {
      edit.mergeBlocks({ sourceIds: [20], targetId: 10 });
      edit.removeBlock(10);
    });

    expect(outcome.model.blocks).toEqual([{ id: 30, elementIds: [3] }]);
    expect(outcome.model.elements.map(({ id }) => id)).toEqual([3]);
    expect(outcome.model.bodies).toEqual([{ id: 40, elementIds: [3] }]);
    expect(outcome.report.removedBlockIds).toEqual([10, 20]);
  });
});
