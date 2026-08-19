import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createViewport,
  createPart,
  createScene,
  identity,
  translation,
  type Viewport,
  type Scene,
} from "../../../src/entries/root";
import { RendererAttachment } from "../../../src/renderer/attachment";
import { remapAttachmentFlags } from "../../../src/renderer/attachment/reconciliation";
import { createGpuBundle, destroyGpuBundle } from "../../../src/renderer/recovery";
import { destroyVisibilitySkinCache } from "../../../src/renderer/visibility/skins";
import {
  createPackedSceneRuntime,
  type PackedSceneRuntime,
} from "../../../src/scene-runtime/runtime";
import { createInteractionState } from "../../../src/interaction/interaction";
import { setElementVisible } from "../../../src/interaction/elements";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";
import { measureMs, measureScaling } from "../measure";

const PLACEMENT_COUNTS = [1_024, 4_096, 16_384] as const;
const VISIBILITY_FACE_COUNTS = [16_384, 65_536, 262_144] as const;
const originalNavigator = globalThis.navigator;
const fixtures = PLACEMENT_COUNTS.map(createReplacementFixture);
let restoreGpuGlobals: (() => void) | undefined;
let viewports: Viewport[] = [];
let transformViewport: Viewport | undefined;
let variantFixtures: VariantFixture[] = [];
let visibilityFixtures: VisibilityFixture[] = [];

beforeAll(async () => {
  restoreGpuGlobals = installGpuGlobals();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
  viewports = await Promise.all(
    fixtures.map(({ first }) =>
      createViewport({ canvas: fakeCanvas(), scene: first, device: fakeGpuDevice().device }),
    ),
  );
  transformViewport = await createViewport({
    canvas: fakeCanvas(),
    scene: createReplacementFixture(100_000).first,
    device: fakeGpuDevice().device,
  });
  transformViewport.render();
  variantFixtures = await Promise.all(PLACEMENT_COUNTS.map(createVariantFixture));
});

afterAll(() => {
  for (const viewport of viewports) viewport.destroy();
  transformViewport?.destroy();
  for (const fixture of variantFixtures) destroyGpuBundle(fixture.bundle);
  for (const fixture of visibilityFixtures) destroyGpuBundle(fixture.bundle);
  restoreGpuGlobals?.();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

describe("public scene replacement scaling", () => {
  it("keeps Viewport.replaceScene approximately linear", () => {
    const nextScene = fixtures.map(() => 1);
    const measurements = measureScaling(
      fixtures.map(({ first, second }, index) => ({
        size: PLACEMENT_COUNTS[index] ?? 0,
        run: () => {
          const viewport = viewports[index];
          if (viewport === undefined) throw new Error("Scene replacement viewport is missing");
          const useSecond = nextScene[index] === 1;
          viewport.replaceScene(useSecond ? second : first);
          nextScene[index] = useSecond ? 0 : 1;
          expect(viewport.runtime.partOccurrenceCount).toBe(PLACEMENT_COUNTS[index]);
        },
      })),
      // Batch repeatable replacements so timer and scheduler noise does not
      // dominate the smallest normalized measurement.
      { warmup: 1, samples: 3, iterations: 5 },
    );
    const normalized = measurements.map(({ millisecondsPerUnit }) => millisecondsPerUnit);
    const spread = Math.max(...normalized) / Math.min(...normalized);
    if (process.env["PERF_REPORT"] !== undefined) {
      console.log(
        `Viewport.replaceScene: ${measurements
          .map(({ size, measuredMs }) => `${size}=${measuredMs.toFixed(3)} ms`)
          .join(", ")}`,
      );
    }
    expect(
      spread,
      `Viewport.replaceScene normalized cost spread was ${spread.toFixed(2)}x`,
    ).toBeLessThanOrEqual(5);
  });
});

describe("public scene update scaling", () => {
  it("keeps one transform in a 100k-occurrence scene within one frame", () => {
    const viewport = transformViewport;
    if (viewport === undefined) throw new Error("Transform viewport is missing");
    let offset = 1;
    const measuredMs = measureMs(
      () => {
        viewport.updateScene((update) => {
          update.setPartOccurrenceTransform({
            assemblyId: 1,
            placementId: "99999",
            transform: translation(offset, 0, 0),
          });
        });
        offset = offset === 1 ? 2 : 1;
      },
      { warmup: 2, samples: 7 },
    );
    if (process.env["PERF_REPORT"] !== undefined) {
      console.log(`Viewport.updateScene transform (100k): ${measuredMs.toFixed(3)} ms`);
    }
    expect(measuredMs).toBeLessThanOrEqual(16.7);
  });

  it("keeps one direct add or removal in a 100k-occurrence scene within one frame", () => {
    const viewport = transformViewport;
    if (viewport === undefined) throw new Error("Occurrence viewport is missing");
    let present = true;
    const measuredMs = measureMs(
      () => {
        viewport.updateScene((update) => {
          if (present) update.removePartOccurrence({ assemblyId: 1, placementId: "99999" });
          else {
            update.addPartOccurrence({
              assemblyId: 1,
              placementId: "99999",
              partId: 1,
              transform: identity(),
            });
          }
        });
        present = !present;
      },
      { warmup: 2, samples: 7 },
    );
    if (process.env["PERF_REPORT"] !== undefined) {
      console.log(`Viewport.updateScene occurrence (100k): ${measuredMs.toFixed(3)} ms`);
    }
    expect(measuredMs).toBeLessThanOrEqual(16.7);
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
      { iterations: 5 },
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

  it("remaps occurrence flags beyond the spread-argument limit", () => {
    const count = 200_001;
    const previous = sequenceRuntime(count, 0, false);
    const runtime = sequenceRuntime(count, 1, true);
    const marked = Array.from({ length: count }, (_, slot) => slot === 1);
    const state = {
      edgeFlags: [...marked],
      edgeEmphasisFlags: [...marked],
      nodeFlags: [...marked],
      transparentFlags: [...marked],
      selectedNodeFlags: [...marked],
    };

    remapAttachmentFlags(previous, runtime, state);

    for (const flags of Object.values(state)) {
      expect(flags).toHaveLength(count);
      expect(flags[0]).toBe(false);
      expect(flags[count - 1]).toBe(true);
      expect(flags.filter(Boolean)).toHaveLength(1);
    }
  });
});

function sequenceRuntime(count: number, firstId: number, reversed: boolean): PackedSceneRuntime {
  return {
    instanceCount: count,
    getInstanceId: (slot: number) => String(firstId + (reversed ? count - slot - 1 : slot)),
    getInstanceSlot: (instanceId: string) => {
      const index = Number(instanceId) - firstId;
      if (index < 0 || index >= count) return undefined;
      return reversed ? count - index - 1 : index;
    },
  } as unknown as PackedSceneRuntime;
}

describe("renderer visibility-skin scaling", () => {
  it("keeps one hidden-element skin rebuild approximately linear in retained faces", async () => {
    visibilityFixtures = await Promise.all(VISIBILITY_FACE_COUNTS.map(createVisibilityFixture));
    const nextHidden = visibilityFixtures.map(() => false);
    const measurements = measureScaling(
      visibilityFixtures.map((fixture, index) => ({
        size: VISIBILITY_FACE_COUNTS[index] ?? 0,
        run: () => {
          let interaction = createInteractionState();
          const hidden = !nextHidden[index];
          interaction = setElementVisible(
            interaction,
            { partOccurrenceId: "1/0", elementId: 101 },
            !hidden,
          );
          fixture.attachment.updateElements(
            fixture.runtime,
            interaction,
            fixture.bundle,
            fixture.scene.parts,
          );
          if (!hidden) destroyVisibilitySkinCache(fixture.bundle.draw, 1);
          nextHidden[index] = hidden;
          expect(fixture.attachment.calls.length).toBeGreaterThan(0);
        },
      })),
      { warmup: 1, samples: 3, iterations: 20 },
    );
    const normalized = measurements.map(({ millisecondsPerUnit }) => millisecondsPerUnit);
    const spread = Math.max(...normalized) / Math.min(...normalized);
    if (process.env["PERF_REPORT"] !== undefined) {
      console.log(
        `Renderer visibility skin: ${measurements
          .map(({ size, measuredMs }) => `${size}=${measuredMs.toFixed(3)} ms`)
          .join(", ")}`,
      );
    }
    expect(
      spread,
      `Renderer visibility skin normalized cost spread was ${spread.toFixed(2)}x`,
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

interface VisibilityFixture {
  readonly scene: Scene;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly attachment: RendererAttachment;
  readonly bundle: Awaited<ReturnType<typeof createGpuBundle>>;
}

async function createVisibilityFixture(faceCount: number): Promise<VisibilityFixture> {
  const part = createVisibilityPart(faceCount);
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "visibility",
      placements: [{ kind: "part", placementId: "0", partId: part.id, transform: identity() }],
    })
    .withRoot(1)
    .build();
  const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
  const attachment = new RendererAttachment();
  const runtime = createPackedSceneRuntime(scene);
  attachment.prepareParts(scene.parts, bundle);
  attachment.attach(runtime, bundle);
  return { scene, runtime, attachment, bundle };
}

function createVisibilityPart(faceCount: number) {
  const positions = new Float32Array(faceCount * 9);
  const indices = Uint32Array.from({ length: faceCount * 3 }, (_, index) => index);
  const faces = Array.from({ length: faceCount }, (_, index) => ({
    elementId: index + 101,
    faceIndex: 0,
    primitiveStart: index,
    primitiveCount: 1,
    key: String(index),
    nodeIds: [0, 1, 2],
  }));
  return createPart(1, {
    geometries: [
      {
        primitive: "triangles" as const,
        positions,
        indices,
        faces,
        faceSubset: { faceIds: [{ elementId: 101, faceIndex: 0 }] },
      },
    ],
    elements: faces.map((face) => ({
      id: face.elementId,
      primitiveRanges: [
        { primitive: "triangles" as const, primitiveStart: face.primitiveStart, primitiveCount: 1 },
      ],
    })),
  });
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
