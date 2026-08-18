import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import { RendererAttachment } from "../../src/renderer/attachment";
import { createGpuBundle, destroyGpuBundle } from "../../src/renderer/recovery";
import {
  encodeInstanceRecord,
  INSTANCE_STRIDE,
} from "../../src/renderer/resources/instance-storage";
import { defaultStyle } from "../../src/renderer/resources/foundation";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { fakeGpuDevice, installGpuGlobals, type RecordedWrite } from "../renderer/fake-gpu";
import { buildTinyManyPieceScene, type SceneShape } from "./fixtures";
import { median, percentile, SAMPLE_COUNT } from "./measure";

interface ColdAttachmentRow {
  readonly shape: SceneShape;
  readonly partCount: number;
  readonly occurrenceCount: number;
  readonly sceneBuildP50Ms: number;
  readonly runtimeCompileP50Ms: number;
  readonly semanticSetupP50Ms: number;
  readonly resourcePrepareP50Ms: number;
  readonly fullAttachP50Ms: number;
  readonly fullAttachP95Ms: number;
  readonly storageCount: number;
  readonly instanceWriteCalls: number;
  readonly instanceWriteBytes: number;
  readonly orderWriteCalls: number;
  readonly orderWriteBytes: number;
}

type AttachmentMetrics = Pick<
  ColdAttachmentRow,
  | "storageCount"
  | "instanceWriteCalls"
  | "instanceWriteBytes"
  | "orderWriteCalls"
  | "orderWriteBytes"
>;

interface Sample extends AttachmentMetrics {
  readonly sceneBuildMs: number;
  readonly runtimeCompileMs: number;
  readonly semanticSetupMs: number;
  readonly resourcePrepareMs: number;
  readonly fullAttachMs: number;
}

const SIZES = [100, 1_000, 4_000] as const;
let restoreGpuGlobals: (() => void) | undefined;

beforeAll(() => {
  restoreGpuGlobals = installGpuGlobals();
});

afterAll(() => {
  restoreGpuGlobals?.();
});

describe("cold renderer attachment", () => {
  it("separates geometry-resource setup from placement encoding", async () => {
    const rows: ColdAttachmentRow[] = [];
    for (const shape of ["shared-part", "distinct-parts"] as const) {
      for (const size of SIZES) rows.push(await measureTier(shape, size));
    }
    expect(rows).toHaveLength(6);
    console.log(JSON.stringify({ schemaVersion: 1, rows }, undefined, 2));
  }, 300_000);
});

async function measureTier(shape: SceneShape, occurrenceCount: number): Promise<ColdAttachmentRow> {
  const samples: Sample[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    samples.push(await measureColdSample(shape, occurrenceCount));
  }
  return {
    shape,
    partCount: shape === "shared-part" ? 1 : occurrenceCount,
    occurrenceCount,
    sceneBuildP50Ms: median(samples.map((sample) => sample.sceneBuildMs)),
    runtimeCompileP50Ms: median(samples.map((sample) => sample.runtimeCompileMs)),
    semanticSetupP50Ms: median(samples.map((sample) => sample.semanticSetupMs)),
    resourcePrepareP50Ms: median(samples.map((sample) => sample.resourcePrepareMs)),
    fullAttachP50Ms: median(samples.map((sample) => sample.fullAttachMs)),
    fullAttachP95Ms: percentile(
      samples.map((sample) => sample.fullAttachMs),
      0.95,
    ),
    storageCount: exact(samples, "storageCount"),
    instanceWriteCalls: exact(samples, "instanceWriteCalls"),
    instanceWriteBytes: exact(samples, "instanceWriteBytes"),
    orderWriteCalls: exact(samples, "orderWriteCalls"),
    orderWriteBytes: exact(samples, "orderWriteBytes"),
  };
}

async function measureColdSample(shape: SceneShape, occurrenceCount: number): Promise<Sample> {
  let started = performance.now();
  const scene = buildTinyManyPieceScene(shape, occurrenceCount);
  const sceneBuildMs = performance.now() - started;
  started = performance.now();
  const runtime = createPackedSceneRuntime(scene);
  const runtimeCompileMs = performance.now() - started;
  const gpu = fakeGpuDevice();
  const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
  const attachment = new RendererAttachment();
  started = performance.now();
  for (const part of scene.parts.values()) getPartSemanticIndex(part);
  const semanticSetupMs = performance.now() - started;
  started = performance.now();
  attachment.prepareParts(scene.parts, bundle);
  const resourcePrepareMs = performance.now() - started;
  const writeStart = gpu.writes.length;
  started = performance.now();
  attachment.attach(runtime, bundle);
  const fullAttachMs = performance.now() - started;
  const metrics = assertAttachment({
    shape,
    occurrenceCount,
    attachment,
    runtime,
    bundle,
    writes: gpu.writes.slice(writeStart),
  });
  destroyGpuBundle(bundle);
  return {
    sceneBuildMs,
    runtimeCompileMs,
    semanticSetupMs,
    resourcePrepareMs,
    fullAttachMs,
    ...metrics,
  };
}

function assertAttachment(options: {
  readonly shape: SceneShape;
  readonly occurrenceCount: number;
  readonly attachment: RendererAttachment;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly bundle: Awaited<ReturnType<typeof createGpuBundle>>;
  readonly writes: readonly RecordedWrite[];
}): AttachmentMetrics {
  const { shape, occurrenceCount, attachment, runtime, bundle, writes } = options;
  const layout = attachment.layout;
  if (layout === undefined) throw new Error("Cold attachment did not retain its layout");
  const expectedParts = shape === "shared-part" ? 1 : occurrenceCount;
  expect(layout.partOrder).toHaveLength(expectedParts);
  expect(bundle.draw.storages.size).toBe(expectedParts);
  const instanceBuffers = new Set<GPUBuffer>();
  const orderBuffers = new Set<GPUBuffer>();
  for (const storage of bundle.draw.storages.values()) {
    instanceBuffers.add(storage.buffer);
    orderBuffers.add(storage.orderBuffer);
  }
  const instanceWrites = writes.filter((write) => instanceBuffers.has(write.buffer));
  const orderWrites = writes.filter((write) => orderBuffers.has(write.buffer));
  expect(instanceWrites).toHaveLength(expectedParts);
  expect(orderWrites).toHaveLength(expectedParts);
  expect(writes).toHaveLength(expectedParts * 2);
  const instanceWriteBytes = sumWriteBytes(instanceWrites);
  const orderWriteBytes = sumWriteBytes(orderWrites);
  expect(instanceWriteBytes).toBe(occurrenceCount * INSTANCE_STRIDE);
  expect(orderWriteBytes).toBe(occurrenceCount * Uint32Array.BYTES_PER_ELEMENT);
  assertStorageMirrors(attachment, runtime, bundle);
  return {
    storageCount: expectedParts,
    instanceWriteCalls: instanceWrites.length,
    instanceWriteBytes,
    orderWriteCalls: orderWrites.length,
    orderWriteBytes,
  };
}

function assertStorageMirrors(
  attachment: RendererAttachment,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
  bundle: Awaited<ReturnType<typeof createGpuBundle>>,
): void {
  const layout = attachment.layout;
  if (layout === undefined) throw new Error("Cold attachment layout is missing");
  for (const partId of layout.partOrder) {
    const storage = bundle.draw.storages.get(partId);
    const slots = layout.partLocalSlots.get(partId);
    if (storage === undefined || slots === undefined) throw new Error("Part storage is missing");
    expect(storage.orderLength).toBe(slots.length);
    for (let local = 0; local < slots.length; local += 1) {
      const slot = slots[local];
      if (slot === undefined || slot < 0) throw new Error("Initial part-local slot is missing");
      const expected = encodeInstanceRecord(
        runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
        defaultStyle,
        slot + 1,
      );
      const actual = new Uint8Array(storage.data, local * INSTANCE_STRIDE, INSTANCE_STRIDE);
      expect(actual).toEqual(new Uint8Array(expected));
      expect(storage.orderData[local]).toBe(local);
    }
  }
}

function sumWriteBytes(writes: readonly RecordedWrite[]): number {
  return writes.reduce((sum, write) => sum + write.bytes.byteLength, 0);
}

function exact<Key extends keyof Sample>(samples: readonly Sample[], key: Key): Sample[Key] {
  const value = samples[0]?.[key];
  for (const sample of samples) expect(sample[key]).toBe(value);
  return value as Sample[Key];
}
