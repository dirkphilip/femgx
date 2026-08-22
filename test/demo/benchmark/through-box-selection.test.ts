import { describe, expect, it } from "vitest";
import { identityMatrix, type Scene, type SectionPlane, type Viewport } from "@/entries/root";
import { createInteractionState, type ElementRegionSelection } from "@/entries/interaction";
import { createCamera } from "@/entries/camera";
import { createSceneOccurrenceSnapshot } from "@/scene-runtime/occurrences";
import { createStructuredFePart } from "../../../demo/benchmark/structured-fe";
import type { BoxSelectionRequest } from "../../../demo/workbench/selection/box-selection-resolver";
import { throughIntersectionBoxSelectionResolver } from "../../../demo/workbench/selection/through-box-selection";
import { queryData } from "../../../demo/workbench/selection/through-box-geometry";

const NARROW_RECT = { left: 390, top: 290, right: 410, bottom: 310, width: 20, height: 20 };
const BROAD_RECT = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
const HALF_RECT = { left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600 };

const CASES = [
  { family: "tet4" as const, gridSize: 28 },
  { family: "hex8" as const, gridSize: 51 },
] as const;

describe("through-box selection benchmark", () => {
  it.each(CASES)(
    "measures dense $family query work after setup",
    async ({ family, gridSize }) => {
      const { resolver, expectedCount, part, setSectionPlane } = denseFixture(family, gridSize);
      const narrowRequest = request(NARROW_RECT);
      const broadRequest = request(BROAD_RECT);
      const halfRequest = request(HALF_RECT);
      const coldStart = performance.now();
      const halfTargets = await resolver(halfRequest);
      const coldHalf = performance.now() - coldStart;
      const narrowTargets = await resolver(narrowRequest);
      const broadTargets = await resolver(broadRequest);
      expect(elementCount(narrowTargets)).toBeGreaterThan(0);
      expect(elementCount(halfTargets)).toBeGreaterThan(0);
      expect(elementCount(halfTargets)).toBeLessThan(elementCount(broadTargets));
      const narrow = await measure(resolver, narrowRequest, 3, elementCount(narrowTargets));
      const half = await measure(resolver, halfRequest, 3, elementCount(halfTargets));
      const broad = await measure(resolver, broadRequest, 3, expectedCount);
      setSectionPlane({ normal: [0, 0, 1], distance: -gridSize / 2 });
      const sectionTargets = await resolver(halfRequest);
      const sectionHalf = await measure(resolver, halfRequest, 3, elementCount(sectionTargets));
      const boundsBytes = queryData(part).elementBounds.byteLength;

      console.info(
        `through-box ${family} ${gridSize}^3: cold half ${coldHalf.toFixed(2)} ms, ` +
          `narrow median ${narrow.toFixed(2)} ms, ` +
          `half median ${half.toFixed(2)} ms (${elementCount(halfTargets)} elements), ` +
          `broad median ${broad.toFixed(2)} ms, section half ${sectionHalf.toFixed(2)} ms, ` +
          `${expectedCount} elements, ${boundsBytes} bounds bytes`,
      );
      expect(boundsBytes).toBe(expectedCount * 6 * Float32Array.BYTES_PER_ELEMENT);
      expect(coldHalf).toBeGreaterThanOrEqual(0);
      expect(narrow).toBeGreaterThanOrEqual(0);
      expect(broad).toBeGreaterThanOrEqual(0);
    },
    60_000,
  );
});

function elementCount(
  result: Awaited<ReturnType<ReturnType<typeof throughIntersectionBoxSelectionResolver>>>,
): number {
  if (Array.isArray(result)) throw new Error("Through resolver returned targets");
  return (result as ElementRegionSelection).count;
}

function denseFixture(
  family: "tet4" | "hex8",
  gridSize: number,
): {
  readonly resolver: ReturnType<typeof throughIntersectionBoxSelectionResolver>;
  readonly expectedCount: number;
  readonly part: ReturnType<typeof createStructuredFePart>;
  readonly setSectionPlane: (plane: SectionPlane | undefined) => void;
} {
  const part = createStructuredFePart(1, family, gridSize);
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
  const presentation: { sectionPlane: SectionPlane | undefined } = { sectionPlane: undefined };
  const view: Viewport = {
    scene,
    occurrences: runtime,
    view: {
      camera: createCamera({
        mode: "orthographic",
        position: [gridSize / 2, gridSize / 2, gridSize * 3],
        target: [gridSize / 2, gridSize / 2, gridSize / 2],
        up: [0, 1, 0],
        width: 800,
        height: 600,
        orthoHeight: gridSize,
      }),
    },
    interaction: { state: createInteractionState() },
    visibility: {
      isElementEffectivelyVisible: () => true,
    },
    results: { state: undefined },
    presentation,
  } as unknown as Viewport;
  return {
    resolver: throughIntersectionBoxSelectionResolver(() => view),
    expectedCount: family === "tet4" ? gridSize ** 3 * 6 : gridSize ** 3,
    part,
    setSectionPlane: (sectionPlane) => {
      presentation.sectionPlane = sectionPlane;
    },
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
    if (expectedCount > 0) expect(elementCount(targets)).toBe(expectedCount);
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
