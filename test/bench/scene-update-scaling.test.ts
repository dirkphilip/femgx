import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFemViewport,
  createPart,
  createScene,
  identity,
  translation,
  type FemViewport,
  type Scene,
} from "../../src/entries/root";
import { RendererAttachment } from "../../src/renderer/attachment";
import { createGpuBundle, destroyGpuBundle } from "../../src/renderer/recovery";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../renderer/fake-gpu";
import { measureScaling } from "./measure";

const PLACEMENT_COUNTS = [1_024, 4_096, 16_384] as const;
const originalNavigator = globalThis.navigator;
const fixtures = PLACEMENT_COUNTS.map(createReplacementFixture);
let restoreGpuGlobals: (() => void) | undefined;
let viewports: FemViewport[] = [];
let variantFixtures: VariantFixture[] = [];

beforeAll(async () => {
  restoreGpuGlobals = installGpuGlobals();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
  viewports = await Promise.all(
    fixtures.map(({ first }) =>
      createFemViewport({ canvas: fakeCanvas(), scene: first, device: fakeGpuDevice().device }),
    ),
  );
  variantFixtures = await Promise.all(PLACEMENT_COUNTS.map(createVariantFixture));
});

afterAll(() => {
  for (const viewport of viewports) viewport.destroy();
  for (const fixture of variantFixtures) destroyGpuBundle(fixture.bundle);
  restoreGpuGlobals?.();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

describe("public scene replacement scaling", () => {
  it("keeps FemViewport.setScene approximately linear", () => {
    const nextScene = fixtures.map(() => 1);
    const measurements = measureScaling(
      fixtures.map(({ first, second }, index) => ({
        size: PLACEMENT_COUNTS[index] ?? 0,
        run: () => {
          const viewport = viewports[index];
          if (viewport === undefined) throw new Error("Scene replacement viewport is missing");
          const useSecond = nextScene[index] === 1;
          viewport.setScene(useSecond ? second : first);
          nextScene[index] = useSecond ? 0 : 1;
          expect(viewport.runtime.instanceCount).toBe(PLACEMENT_COUNTS[index]);
        },
      })),
      { warmup: 1, samples: 3 },
    );
    const normalized = measurements.map(({ millisecondsPerUnit }) => millisecondsPerUnit);
    const spread = Math.max(...normalized) / Math.min(...normalized);
    if (process.env["PERF_REPORT"] !== undefined) {
      console.log(
        `FemViewport.setScene: ${measurements
          .map(({ size, measuredMs }) => `${size}=${measuredMs.toFixed(3)} ms`)
          .join(", ")}`,
      );
    }
    expect(
      spread,
      `FemViewport.setScene normalized cost spread was ${spread.toFixed(2)}x`,
    ).toBeLessThanOrEqual(3);
  });
});

describe("renderer host-variant reconciliation scaling", () => {
  it("keeps one-occurrence rebind work independent of unchanged placements", () => {
    const nextScene = variantFixtures.map(() => 1);
    const measurements = measureScaling(
      variantFixtures.map((fixture, index) => ({
        size: PLACEMENT_COUNTS[index] ?? 0,
        run: () => {
          const useSecond = nextScene[index] === 1;
          const runtime = useSecond ? fixture.secondRuntime : fixture.firstRuntime;
          const scene = useSecond ? fixture.second : fixture.first;
          fixture.attachment.prepareParts(scene.parts, fixture.bundle);
          fixture.attachment.attach(runtime, fixture.bundle);
          nextScene[index] = useSecond ? 0 : 1;
          expect(fixture.attachment.instances).toHaveLength(PLACEMENT_COUNTS[index] ?? 0);
        },
      })),
      { warmup: 1, samples: 3 },
    );
    const normalized = measurements.map(({ millisecondsPerUnit }) => millisecondsPerUnit);
    const spread = Math.max(...normalized) / Math.min(...normalized);
    if (process.env["PERF_REPORT"] !== undefined) {
      console.log(
        `Renderer variant attach: ${measurements
          .map(({ size, measuredMs }) => `${size}=${measuredMs.toFixed(3)} ms`)
          .join(", ")}`,
      );
    }
    expect(
      spread,
      `Renderer variant attach normalized cost spread was ${spread.toFixed(2)}x`,
    ).toBeLessThanOrEqual(3);
  });
});

interface VariantFixture {
  readonly first: Scene;
  readonly second: Scene;
  readonly firstRuntime: ReturnType<typeof createPackedSceneRuntime>;
  readonly secondRuntime: ReturnType<typeof createPackedSceneRuntime>;
  readonly attachment: RendererAttachment;
  readonly bundle: Awaited<ReturnType<typeof createGpuBundle>>;
}

async function createVariantFixture(placementCount: number): Promise<VariantFixture> {
  const partA = createPart(1, {
    geometries: [
      {
        positions: new Float32Array([0, 0, 0]),
        indices: new Uint32Array([0]),
        primitive: "points",
      },
    ],
  });
  const partB = createPart(2, {
    geometries: [
      {
        positions: new Float32Array([1, 0, 0]),
        indices: new Uint32Array([0]),
        primitive: "points",
      },
    ],
  });
  const makeScene = (rebound: boolean): Scene =>
    createScene()
      .addPart(partA)
      .addPart(partB)
      .addAssembly({
        id: 1,
        name: "variant",
        placements: Array.from({ length: placementCount }, (_, index) => ({
          kind: "part" as const,
          placementId: String(index),
          partId:
            rebound && index === 0 ? partB.id : index === placementCount - 1 ? partB.id : partA.id,
          transform: translation(index, 0, 0),
        })),
      })
      .withRoot(1)
      .build();
  const first = makeScene(false);
  const second = makeScene(true);
  const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
  const attachment = new RendererAttachment();
  const firstRuntime = createPackedSceneRuntime(first);
  const secondRuntime = createPackedSceneRuntime(second);
  attachment.prepareParts(first.parts, bundle);
  attachment.attach(firstRuntime, bundle);
  return { first, second, firstRuntime, secondRuntime, attachment, bundle };
}

function createReplacementFixture(placementCount: number): {
  readonly first: Scene;
  readonly second: Scene;
} {
  const part = createPart(1, {
    geometries: [
      {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles",
      },
    ],
  });
  const scene = (offset: number): Scene =>
    createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "replacement",
        placements: Array.from({ length: placementCount }, (_, index) => ({
          kind: "part" as const,
          placementId: String(index),
          partId: part.id,
          transform: offset === 0 ? identity() : translation(offset, 0, 0),
        })),
      })
      .withRoot(1)
      .build();
  return { first: scene(0), second: scene(1) };
}
