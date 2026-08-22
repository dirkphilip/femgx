import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { identityMatrix, type Scene, type Viewport } from "@/entries/root";
import { createInteractionState } from "@/entries/interaction";
import { setElementVisible } from "@/interaction/elements";
import { createCamera } from "@/entries/camera";
import { createSceneOccurrenceSnapshot } from "@/scene-runtime/occurrences";
import { createStructuredFePart } from "../../../demo/benchmark/structured-fe";
import {
  createThroughWorkflowRunner,
  type ThroughWorkflowConfiguration,
} from "./element-region-workflow";
import { installGpuGlobals } from "../../renderer/fake-gpu";
import {
  installFakeWindow,
  restoreFakeWindow,
} from "../../interaction/viewport-interaction-support";

const GRID_SIZE = 35;
const ELEMENT_COUNT = GRID_SIZE ** 3 * 6;
let restoreGpu: (() => void) | undefined;

beforeAll(() => {
  restoreGpu = installGpuGlobals();
  installFakeWindow();
});

afterAll(() => {
  restoreFakeWindow();
  restoreGpu?.();
});

describe("packed Through host workflow", () => {
  it("keeps broad 257k Tet4 handoff exact with hidden, sectioned, and deformed display state", async () => {
    const part = createStructuredFePart(1, "tet4", GRID_SIZE);
    const cases: readonly {
      readonly name: string;
      readonly expected: (count: number) => void;
      readonly configure?: (occurrenceId: string) => ThroughWorkflowConfiguration["configure"];
    }[] = [
      {
        name: "complete",
        expected: (count) => {
          expect(count).toBe(ELEMENT_COUNT);
        },
      },
      {
        name: "hidden element",
        expected: (count) => {
          expect(count).toBe(ELEMENT_COUNT - 1);
        },
        configure:
          (partOccurrenceId) =>
          ({ interaction }) => {
            const hidden = setElementVisible(
              createInteractionState(),
              { partOccurrenceId, elementId: 1 },
              false,
            );
            interaction.host = hidden;
            interaction.viewport = hidden;
          },
      },
      {
        name: "section plane",
        expected: (count) => {
          expect(count).toBeGreaterThan(0);
          expect(count).toBeLessThan(ELEMENT_COUNT);
        },
        configure:
          () =>
          ({ viewport }) => {
            (viewport.presentation as { sectionPlane: unknown }).sectionPlane = {
              normal: [0, 0, 1],
              distance: -GRID_SIZE / 2,
            };
          },
      },
      {
        name: "deformation",
        expected: (count) => {
          expect(count).toBe(ELEMENT_COUNT);
        },
        configure:
          () =>
          ({ viewport }) => {
            const displacements = new Float32Array(part.nodePositions?.length ?? 0);
            displacements[0] = 0.25;
            (viewport.results as { state: unknown }).state = {
              config: {},
              scalar: undefined,
              deformation: { scale: 1, displacements: new Map([[part.id, displacements]]) },
              orientation: undefined,
            };
          },
      },
    ];
    for (const testCase of cases) {
      const { scene, viewport, partOccurrenceId } = fixture(part);
      const configuration: ThroughWorkflowConfiguration = { workloadCount: ELEMENT_COUNT };
      if (testCase.configure !== undefined) {
        Object.assign(configuration, { configure: testCase.configure(partOccurrenceId) });
      }
      const runner = await createThroughWorkflowRunner(
        1,
        scene,
        () => viewport,
        (selection) => {
          testCase.expected(selection.count);
        },
        configuration,
      );
      try {
        await runner.run();
        expect(runner.details).toMatchObject({
          descriptorVisits: 0,
          defaultElementTransitions: 1,
          applyCallbacks: 1,
          hostStatePublications: 1,
          rendererSynchronizations: 1,
          requestedRenders: 1,
        });
      } finally {
        runner.dispose();
      }
    }
  }, 60_000);
});

function fixture(part: ReturnType<typeof createStructuredFePart>): {
  readonly scene: Scene;
  readonly viewport: Viewport;
  readonly partOccurrenceId: string;
} {
  const scene: Scene = {
    rootAssemblyId: 1,
    parts: new Map([[part.id, part]]),
    assemblies: new Map([
      [
        1,
        {
          id: 1,
          name: "root",
          placements: [
            { kind: "part", placementId: "dense", partId: part.id, transform: identityMatrix() },
          ],
        },
      ],
    ]),
    visiblePartIds: new Set([part.id]),
    visibleAssemblyIds: new Set([1]),
  };
  const occurrences = createSceneOccurrenceSnapshot(scene);
  const partOccurrenceId = occurrences.getPartOccurrenceId(0);
  if (partOccurrenceId === undefined) throw new Error("Tet4 workflow occurrence is missing");
  return {
    scene,
    partOccurrenceId,
    viewport: {
      scene,
      occurrences,
      view: {
        camera: createCamera({
          mode: "orthographic",
          position: [GRID_SIZE / 2, GRID_SIZE / 2, GRID_SIZE * 3],
          target: [GRID_SIZE / 2, GRID_SIZE / 2, GRID_SIZE / 2],
          up: [0, 1, 0],
          width: 800,
          height: 600,
          orthoHeight: GRID_SIZE,
        }),
      },
      interaction: { state: createInteractionState() },
      results: { state: undefined },
      presentation: { sectionPlane: undefined },
    } as unknown as Viewport,
  };
}
