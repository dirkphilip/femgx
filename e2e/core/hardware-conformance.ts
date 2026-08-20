import { createSceneBuilder, translationMatrix, type Scene, type Viewport } from "../../src/entries/root";
import { projectPoint, setProjection } from "../../src/entries/camera";
import {
  createInteractionState,
  setPartOccurrenceOverride,
  setTargetHighlighted,
  setTargetSelected,
} from "../../src/entries/interaction";
import {
  createElement,
  createElementModel,
  createPartFromElementModel,
  ElementShape,
} from "../../src/entries/model";
import { createResultField } from "../../src/entries/results";

type SetStatus = (result: string, message: string, detail?: string) => void;

/** Builds the deterministic solid scene shared by every hardware target. */
export function hardwareConformanceScene(): Scene {
  const model = createElementModel(
    new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
    [createElement(1, ElementShape.Hex8, [0, 1, 2, 3, 4, 5, 6, 7])],
  );
  const part = createPartFromElementModel(1, model);
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "hardware-conformance",
      placements: [
        { kind: "part", partId: part.id, transform: translationMatrix(-1.4, 0, 0) },
        { kind: "part", partId: part.id, transform: translationMatrix(0.4, 0, 0) },
      ],
    })
    .setRootAssembly(1)
    .build();
}

/** Exercises the bounded combined renderer and interaction contract. */
export async function runHardwareConformance(
  current: Viewport,
  canvas: HTMLCanvasElement,
  setStatus: SetStatus,
): Promise<void> {
  current.view.setCamera(setProjection(current.view.camera, "perspective"), { durationMs: 0 });
  current.view.fit({ durationMs: 0 });
  current.results.set({
    scalar: {
      field: createResultField({
        id: "conformance-scalar",
        name: "Conformance scalar",
        location: "nodal",
        shape: "scalar",
        count: 8,
        unit: "unitless",
        values: new Float32Array([0, 0.2, 0.4, 0.2, 0.6, 0.8, 1, 0.8]),
      }),
      range: { min: 0, max: 1 },
    },
  });
  let interaction = createInteractionState();
  interaction = setPartOccurrenceOverride(interaction, "1/1", { opacity: 0.45 });
  const selected = { kind: "partOccurrence", partOccurrenceId: "1/0" } as const;
  interaction = setTargetSelected(interaction, selected, true);
  interaction = setTargetHighlighted(interaction, selected, true);
  current.interaction.set(interaction);
  current.presentation.setSectionPlane({ normal: [0, 1, 0], distance: -0.5 });
  current.render();
  await presentedFrame();
  await presentedFrame();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const region = await current.interaction.pickRegion(
    { left: 0, top: 0, right: width, bottom: height, width, height },
    "element",
  );
  const projected = projectPoint(current.view.camera, [-0.9, 0.75, 1]);
  const picked =
    projected === undefined
      ? undefined
      : await current.interaction.pick(projected[0], projected[1]);
  setStatus(
    "hardware-conformance",
    "hardware-conformance-ready",
    JSON.stringify({
      projection: current.view.camera.mode,
      scalar: current.results.state?.scalar?.field.id,
      section: current.presentation.sectionPlane !== undefined,
      selectedAndHighlighted: true,
      transparentOccurrence: true,
      region: region.length,
      picked: picked?.kind ?? "none",
    }),
  );
}

function presentedFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => {
      resolve();
    }),
  );
}
