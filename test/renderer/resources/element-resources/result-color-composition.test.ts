import { describe, expect, it } from "vitest";
import type { InteractionTarget } from "@/interaction/target-types";
import {
  buildInstanceLayout,
  collectEmphasisUpdates,
  createInteractionState,
  elementScene,
  partsMap,
  setElementSelected,
  setAssemblySelected,
  setTargetHovered,
} from "./support";

describe("selected result-color composition", () => {
  it.each(["body", "element"] as const)(
    "keeps the selected assembly color for hovered %s emphasis",
    (kind) => {
      const { scene, runtime } = elementScene();
      const selectedColor = { r: 0.12, g: 0.64, b: 0.34, a: 1 } as const;
      const target: InteractionTarget =
        kind === "body"
          ? { kind, partOccurrenceId: "1/0", bodyId: 3 }
          : { kind, partOccurrenceId: "1/0", elementId: 0 };
      let interaction = createInteractionState({
        highlighted: {},
        selected: { color: selectedColor },
      });
      interaction = setAssemblySelected(interaction, 1, true);
      interaction = setTargetHovered(interaction, target);
      const updates = collectEmphasisUpdates(
        runtime,
        buildInstanceLayout(runtime),
        new Map([["1/0", 0]]),
        { parts: partsMap(scene), interaction },
      );
      expect(updates.get(1)).toMatchObject([{ style: { color: selectedColor } }]);
    },
  );

  it("does not re-enable result colors for a hovered descendant of a selected assembly", () => {
    const { scene, runtime } = elementScene();
    let interaction = setAssemblySelected(createInteractionState(), 1, true);
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
    expect(updates.get(1)).toMatchObject([{ keepsResultColor: false }]);
  });

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
