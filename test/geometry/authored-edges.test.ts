import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { TET10_SHAPE, TET4_SHAPE } from "../../src/elements/shapes";
import { authoredEdgesForElements } from "../../src/geometry/authored-edges";

describe("authoredEdgesForElements", () => {
  it("retains one occurrence identity and all incident elements for shared edges", () => {
    const elements = [
      createElement(1, TET10_SHAPE, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      createElement(2, TET10_SHAPE, [0, 1, 2, 10, 4, 5, 6, 11, 12, 13]),
    ];
    const shared = authoredEdgesForElements(elements).find((edge) => edge.key === "0,1,4");
    expect(shared).toMatchObject({
      nodeIds: [0, 4, 1],
      incidentElementIds: [1, 2],
    });
    expect(shared?.faceRefs).toHaveLength(4);
  });

  it("keeps linear and quadratic edge identities deterministic", () => {
    const linear = authoredEdgesForElements([createElement(1, TET4_SHAPE, [3, 2, 1, 0])]);
    expect(linear.map((edge) => edge.nodeIds)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });
});
