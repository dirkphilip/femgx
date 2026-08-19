import {
  createPart,
  createScene,
  identity,
  translation,
  type Viewport,
} from "../../src/entries/root";
import { createInteractionState, setTargetSelected } from "../../src/entries/interaction";
import { createResultField } from "../../src/entries/results";

export type SelectionPhase =
  | "all-elemental"
  | "all-elemental-fractional"
  | "all-nodal"
  | "all-but-one-elemental"
  | "all-but-one-nodal";

/** Builds two coplanar reusable parts in either stable submission order. */
export function selectionScene(reverse: boolean, behind: boolean) {
  const part = (id: number) =>
    createPart(id, {
      geometries: [
        {
          positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
          indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
          primitive: "triangles" as const,
          nodePickIds: new Uint32Array([1, 2, 3, 4]),
        },
      ],
      elements: [
        {
          id: 1,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        },
        {
          id: 2,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
        },
      ],
      nodePositions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    });
  const selectedId = reverse ? 2 : 1;
  const selectedTransform = behind ? translation(-0.12, -0.12, -0.2) : identity();
  return createScene()
    .addPart(part(selectedId))
    .addPart(part(reverse ? 1 : 2))
    .addAssembly({
      id: 1,
      name: "selection-precedence",
      placements: [
        { kind: "part", partId: 1, transform: selectedId === 1 ? selectedTransform : identity() },
        { kind: "part", partId: 2, transform: selectedId === 2 ? selectedTransform : identity() },
      ],
    })
    .withRoot(1)
    .build();
}

/** Creates the browser-host callback used to transition selection/result phases. */
export function createSelectionPhaseController(options: {
  readonly current: Viewport;
  readonly caseName: string;
  readonly behind: boolean;
  readonly setStatus: (result: string, message: string) => void;
}): (phase: SelectionPhase) => void {
  return (phase) => {
    applySelectionPhase(options, phase);
  };
}

function applySelectionPhase(
  options: Parameters<typeof createSelectionPhaseController>[0],
  phase: SelectionPhase,
): void {
  const nodal = phase.endsWith("nodal");
  const all = phase.startsWith("all-") && !phase.startsWith("all-but-one");
  const fractional = phase === "all-elemental-fractional";
  const reverseOrder = options.caseName.includes("reverse") || options.caseName.includes("behind");
  const selectedPartId = reverseOrder ? 2 : 1;
  const partOccurrenceId = reverseOrder ? "1/1" : "1/0";
  const interaction = createSelectionInteraction(partOccurrenceId, all, fractional);
  options.current.results.set({
    scalar: {
      field: selectionField(nodal),
      partId: selectedPartId,
      range: { min: 0, max: 1 },
    },
  });
  options.current.interaction.set(interaction);
  options.current.render();
  options.setStatus(
    `selection-${phase}`,
    JSON.stringify({ behind: options.behind, nodal, all, selectedPartId }),
  );
}

function createSelectionInteraction(partOccurrenceId: string, all: boolean, fractional: boolean) {
  let interaction = createInteractionState(
    fractional
      ? {
          highlighted: { emissive: 0.35 },
          selected: { color: { r: 0.95, g: 0.5, b: 0.1, a: 0.5 } },
        }
      : undefined,
  );
  for (const elementId of all ? [1, 2] : [1]) {
    interaction = setTargetSelected(
      interaction,
      { kind: "element", partOccurrenceId, elementId },
      true,
    );
  }
  return interaction;
}

function selectionField(nodal: boolean) {
  return nodal
    ? createResultField({
        id: "nodal-selection-result",
        name: "Nodal selection result",
        location: "nodal",
        shape: "scalar",
        count: 4,
        unit: "unitless",
        values: new Float32Array([0, 0.25, 0.5, 0.75]),
      })
    : createResultField({
        id: "elemental-selection-result",
        name: "Elemental selection result",
        location: "elemental",
        shape: "scalar",
        count: 2,
        unit: "unitless",
        values: new Float32Array([0, 1]),
      });
}
