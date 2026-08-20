import { describe, expect, it } from "vitest";
import { identityMatrix, type Scene, type Viewport } from "../../../src/entries/root";
import { createInteractionState } from "../../../src/entries/interaction";
import { createCamera } from "../../../src/entries/camera";
import { createSceneOccurrenceSnapshot } from "../../../src/scene-runtime/occurrences";
import { createStructuredFePart } from "../../../demo/benchmark/structured-fe";
import type { BoxSelectionRequest } from "../../../demo/workbench/selection/box-selection-resolver";
import { throughIntersectionBoxSelectionResolver } from "../../../demo/workbench/selection/through-box-selection";

const DENSE_CELLS = 28;
const NARROW_RECT = { left: 390, top: 290, right: 410, bottom: 310, width: 20, height: 20 };
const BROAD_RECT = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };

describe("through-box selection benchmark", () => {
  it("measures dense Tet4 query work after setup", async () => {
    const { resolver, expectedCount } = denseTet4Fixture();
    const narrowRequest = request(NARROW_RECT);
    const broadRequest = request(BROAD_RECT);
    const narrowTargets = await resolver(narrowRequest);
    await resolver(broadRequest);
    expect(narrowTargets.length).toBeGreaterThan(0);
    const narrow = await measure(resolver, narrowRequest, 3, narrowTargets.length);
    const broad = await measure(resolver, broadRequest, 3, expectedCount);

    console.info(
      `through-box Tet4 ${DENSE_CELLS}^3: narrow median ${narrow.toFixed(2)} ms, ` +
        `broad median ${broad.toFixed(2)} ms, ${expectedCount} elements`,
    );
    expect(narrow).toBeGreaterThanOrEqual(0);
    expect(broad).toBeGreaterThanOrEqual(0);
  }, 30_000);
});

function denseTet4Fixture(): {
  readonly resolver: ReturnType<typeof throughIntersectionBoxSelectionResolver>;
  readonly expectedCount: number;
} {
  const part = createStructuredFePart(1, "tet4", DENSE_CELLS);
  const scene: Scene = {
    rootAssemblyId: 0,
    parts: new Map([[part.id, part]]),
    assemblies: new Map([
      [
        0,
        {
          id: 0,
          name: "root",
          placements: [
            { kind: "part", placementId: "dense", partId: part.id, transform: identityMatrix() },
          ],
        },
      ],
    ]),
    visiblePartIds: new Set([part.id]),
    visibleAssemblyIds: new Set([0]),
  };
  const runtime = createSceneOccurrenceSnapshot(scene);
  const view: Viewport = {
    scene,
    occurrences: runtime,
    view: {
      camera: createCamera({
        mode: "orthographic",
        position: [14, 14, 80],
        target: [14, 14, 14],
        up: [0, 1, 0],
        width: 800,
        height: 600,
        orthoHeight: 28,
      }),
    },
    interaction: { state: createInteractionState() },
    results: { state: undefined },
    presentation: { sectionPlane: undefined },
  } as unknown as Viewport;
  return {
    resolver: throughIntersectionBoxSelectionResolver(() => view),
    expectedCount: DENSE_CELLS ** 3 * 6,
  };
}

async function measure(
  resolver: ReturnType<typeof throughIntersectionBoxSelectionResolver>,
  selection: BoxSelectionRequest,
  samples: number,
  expectedCount: number,
): Promise<number> {
  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    const targets = await resolver(selection);
    durations.push(performance.now() - start);
    if (expectedCount > 0) expect(targets).toHaveLength(expectedCount);
  }
  durations.sort((left, right) => left - right);
  return durations[Math.floor(durations.length / 2)] ?? 0;
}

function request(rect: typeof NARROW_RECT): BoxSelectionRequest {
  return {
    event: {
      type: "complete",
      anchor: { x: rect.left, y: rect.top },
      current: { x: rect.right, y: rect.bottom },
      rect,
      modifiers: { shift: false, control: false, alt: false, meta: false },
    },
    granularity: "element",
  };
}
