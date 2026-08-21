import { describe, expect, it } from "vitest";
import {
  buildInstanceLayout,
  collectEmphasisUpdates,
  createInteractionState,
  elementScene,
  partsMap,
  setElementSelected,
  setTargetHovered,
} from "./support";

describe("selected result-color composition", () => {
  it("does not re-enable result colors when a selected element is hovered", () => {
    const { scene, runtime } = elementScene();
    let interaction = setElementSelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", elementId: 0 },
      true,
    );
    interaction = setTargetHovered(interaction, {
      kind: "element",
      partOccurrenceId: "1/0",
      elementId: 0,
    });
    const updates = collectEmphasisUpdates(
      runtime,
      buildInstanceLayout(runtime),
      new Map([["1/0", 0]]),
      { parts: partsMap(scene), interaction },
    );
    expect(updates.get(1)).toMatchObject([
      {
        selected: true,
        keepsResultColor: false,
        style: { color: { r: 0.95, g: 0.5, b: 0.1, a: 1 } },
      },
    ]);
  });

  it("retains result colors for a selected element with a colorless theme", () => {
    const { scene, runtime } = elementScene();
    const interaction = setElementSelected(
      createInteractionState({ highlighted: { emissive: 0.4 }, selected: {} }),
      { partOccurrenceId: "1/0", elementId: 0 },
      true,
    );
    const updates = collectEmphasisUpdates(
      runtime,
      buildInstanceLayout(runtime),
      new Map([["1/0", 0]]),
      { parts: partsMap(scene), interaction },
    );
    expect(updates.get(1)).toMatchObject([
      {
        selected: true,
        keepsResultColor: true,
        style: { color: { r: 0.23, g: 0.51, b: 0.96, a: 1 }, emissive: 0 },
      },
    ]);
  });
});
