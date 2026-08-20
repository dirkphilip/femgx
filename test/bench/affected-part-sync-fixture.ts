import { performance } from "node:perf_hooks";
import { expect } from "vitest";
import type { PartId } from "../../src/geometry/part";
import {
  createInteractionState,
  setPartOccurrenceOverride,
} from "../../src/interaction/interaction";
import { setElementVisible } from "../../src/interaction/elements";
import {
  setTargetHovered,
  setTargetsSelected,
  setTargetSelected,
} from "../../src/interaction/targets";
import type { InteractionTarget } from "../../src/interaction/target-types";
import { RendererAttachment } from "../../src/renderer/attachment";
import { createGpuBundle, destroyGpuBundle, type GpuBundle } from "../../src/renderer/recovery";
import { INSTANCE_STRIDE } from "../../src/renderer/resources/instance-storage";
import { HIGHLIGHT_HEADER } from "../../src/renderer/selection/highlight-layout";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { Scene } from "../../src/scene/scene";
import { fakeGpuDevice, type FakeGpu, type RecordedWrite } from "../renderer/fake-gpu";
import { buildTinyManyPieceScene, type SceneShape } from "./fixtures";
import { percentile } from "./measure";

export type { SceneShape } from "./fixtures";
export type SyncOperation =
  "hover" | "selection-one" | "selection-half" | "selection-all" | "recolor" | "visibility";

export interface AffectedPartRow {
  readonly shape: SceneShape;
  readonly size: number;
  readonly operation: SyncOperation;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly writeCalls: number;
  readonly writeBytes: number;
  readonly writtenPartIds: readonly PartId[];
  readonly opaqueCalls: number;
  readonly opaqueInstances: number;
  readonly selectionCalls: number;
  readonly selectionInstances: number;
  readonly selectionTargetCount: number;
  readonly selectionOrderBytes: number;
  readonly highlightBytes: number;
  readonly denseElementOccurrences: number;
  readonly targetEmphasisSlots: number;
  readonly targetVisibilitySkinIndices: number | undefined;
  readonly usesExteriorFaceSubsets: boolean;
}

interface Fixture {
  readonly scene: Scene;
  readonly runtime: PackedSceneRuntime;
  readonly attachment: RendererAttachment;
  readonly bundle: GpuBundle;
  readonly gpu: FakeGpu;
  readonly targetPartId: PartId;
  readonly targetOccurrenceId: string;
}

interface OperationState {
  readonly active: ReturnType<typeof createInteractionState>;
  readonly empty: ReturnType<typeof createInteractionState>;
  readonly selectionTargetCount: number;
}

/** Creates one production attachment fixture without including setup in sync timing. */
export async function createAffectedPartFixture(shape: SceneShape, size: number): Promise<Fixture> {
  const scene = buildTinyManyPieceScene(shape, size);
  const runtime = createPackedSceneRuntime(scene);
  const gpu = fakeGpuDevice();
  const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
  const attachment = new RendererAttachment();
  attachment.prepareParts(scene.parts, bundle);
  attachment.attach(runtime, bundle);
  const targetPartId = runtime.instancePartIds[0];
  const targetOccurrenceId = runtime.getInstanceId(0);
  if (targetPartId === undefined || targetOccurrenceId === undefined) {
    throw new Error("Affected-part benchmark target is missing");
  }
  return { scene, runtime, attachment, bundle, gpu, targetPartId, targetOccurrenceId };
}

/** Destroys the fake-GPU resources retained by one benchmark fixture. */
export function destroyAffectedPartFixture(fixture: Fixture): void {
  destroyGpuBundle(fixture.bundle);
}

/** Measures one active transition while clearing outside each timed sample. */
export function measureAffectedPartOperation(
  fixture: Fixture,
  operation: SyncOperation,
): AffectedPartRow {
  const states = operationStates(fixture, operation);
  warmOperation(fixture, states);
  const samples: number[] = [];
  let writes: readonly RecordedWrite[] = [];
  let opaque = { calls: 0, instances: 0 };
  let selection = { calls: 0, instances: 0 };
  let targetEmphasisSlots = 0;
  let targetVisibilitySkinIndices: number | undefined;
  let usesExteriorFaceSubsets = true;
  let storageMetrics = {
    selectionOrderBytes: 0,
    highlightBytes: 0,
    denseElementOccurrences: 0,
  };
  for (let sample = 0; sample < 7; sample += 1) {
    const startWrites = fixture.gpu.writes.length;
    const started = performance.now();
    sync(fixture, states.active);
    samples.push(performance.now() - started);
    writes = fixture.gpu.writes.slice(startWrites);
    assertWrittenParts(fixture, writes);
    opaque = summarizeCalls(fixture.attachment.calls);
    selection = summarizeCalls(fixture.attachment.selectionCalls);
    ({ targetEmphasisSlots, targetVisibilitySkinIndices } = assertActiveOutcome({
      operation,
      fixture,
      writes,
      opaque,
      selection,
      selectionTargetCount: states.selectionTargetCount,
    }));
    usesExteriorFaceSubsets = fixture.attachment.usesExteriorFaceSubsets;
    storageMetrics = selectionStorageMetrics(fixture, writes);
    sync(fixture, states.empty);
  }
  return {
    shape: fixture.scene.parts.size === 1 ? "shared-part" : "distinct-parts",
    size: fixture.runtime.instanceCount,
    operation,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    writeCalls: writes.length,
    writeBytes: writes.reduce((total, write) => total + write.bytes.byteLength, 0),
    writtenPartIds: writtenPartIds(fixture, writes),
    opaqueCalls: opaque.calls,
    opaqueInstances: opaque.instances,
    selectionCalls: selection.calls,
    selectionInstances: selection.instances,
    selectionTargetCount: states.selectionTargetCount,
    ...storageMetrics,
    targetEmphasisSlots,
    targetVisibilitySkinIndices,
    usesExteriorFaceSubsets,
  };
}

function warmOperation(fixture: Fixture, states: OperationState): void {
  sync(fixture, states.active);
  sync(fixture, states.empty);
}

function selectionStorageMetrics(
  fixture: Fixture,
  writes: readonly RecordedWrite[],
): Pick<AffectedPartRow, "selectionOrderBytes" | "highlightBytes" | "denseElementOccurrences"> {
  const storage = fixture.bundle.draw.storages.get(fixture.targetPartId);
  return {
    selectionOrderBytes: bytesWrittenTo(writes, storage?.sidecars.selection?.buffer),
    highlightBytes: bytesWrittenTo(writes, storage?.highlight.buffer),
    denseElementOccurrences: storage?.highlight.denseSelection?.occurrences.length ?? 0,
  };
}

function assertActiveOutcome(options: {
  readonly operation: SyncOperation;
  readonly fixture: Fixture;
  readonly writes: readonly RecordedWrite[];
  readonly opaque: ReturnType<typeof summarizeCalls>;
  readonly selection: ReturnType<typeof summarizeCalls>;
  readonly selectionTargetCount: number;
}): {
  readonly targetEmphasisSlots: number;
  readonly targetVisibilitySkinIndices: number | undefined;
} {
  const { operation, fixture, writes, opaque, selection, selectionTargetCount } = options;
  const storage = fixture.bundle.draw.storages.get(fixture.targetPartId);
  if (storage === undefined) throw new Error("Affected-part target storage is missing");
  const writeBytes = writes.reduce((total, write) => total + write.bytes.byteLength, 0);
  expect(opaque.calls).toBe(fixture.scene.parts.size);
  expect(opaque.instances).toBe(fixture.runtime.instanceCount);
  if (operation.startsWith("selection-")) {
    expect(selection).toEqual({ calls: 1, instances: selectionTargetCount });
    const orderBytes = bytesWrittenTo(writes, storage.sidecars.selection?.buffer);
    const highlightBytes = bytesWrittenTo(writes, storage.highlight.buffer);
    const denseOccurrences = storage.highlight.denseSelection?.occurrences.length ?? 0;
    expect(orderBytes).toBe(selectionTargetCount * Uint32Array.BYTES_PER_ELEMENT);
    const expectedHighlightBytes =
      denseOccurrences === 0
        ? HIGHLIGHT_HEADER + 48
        : HIGHLIGHT_HEADER +
          storage.capacity * Uint32Array.BYTES_PER_ELEMENT +
          denseOccurrences * Uint32Array.BYTES_PER_ELEMENT;
    expect(highlightBytes).toBe(expectedHighlightBytes);
    expect(writeBytes).toBe(selectionTargetCount * INSTANCE_STRIDE + orderBytes + highlightBytes);
  } else {
    expect(selection).toEqual({ calls: 0, instances: 0 });
  }
  if (operation === "hover") expect(storage.emphasisSlots).toEqual(new Set([0]));
  if (operation === "recolor") expect(writeBytes).toBe(INSTANCE_STRIDE);
  const skinIndices = fixture.attachment.calls.find(
    (call) => call.partId === fixture.targetPartId && call.visibilitySkin !== undefined,
  )?.visibilitySkin?.indexCount;
  if (operation === "visibility") expect(fixture.attachment.usesExteriorFaceSubsets).toBe(false);
  return {
    targetEmphasisSlots: storage.emphasisSlots.size,
    targetVisibilitySkinIndices: skinIndices,
  };
}

function operationStates(fixture: Fixture, operation: SyncOperation): OperationState {
  const empty = createInteractionState();
  const target: InteractionTarget = {
    kind: "element",
    partOccurrenceId: fixture.targetOccurrenceId,
    elementId: 1,
  };
  switch (operation) {
    case "hover":
      return { empty, active: setTargetHovered(empty, target), selectionTargetCount: 0 };
    case "selection-one":
      return { empty, active: setTargetSelected(empty, target, true), selectionTargetCount: 1 };
    case "selection-half":
      return selectedOccurrences(fixture, Math.ceil(fixture.runtime.instanceCount / 2));
    case "selection-all":
      return selectedOccurrences(fixture, fixture.runtime.instanceCount);
    case "recolor":
      return {
        empty,
        active: setPartOccurrenceOverride(empty, fixture.targetOccurrenceId, {
          color: { r: 0.9, g: 0.2, b: 0.1, a: 1 },
        }),
        selectionTargetCount: 0,
      };
    case "visibility":
      return {
        empty,
        active: setElementVisible(empty, target, false),
        selectionTargetCount: 0,
      };
  }
}

function selectedOccurrences(fixture: Fixture, count: number): OperationState {
  const empty = createInteractionState();
  const targets: InteractionTarget[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const partOccurrenceId = fixture.runtime.getInstanceId(slot);
    if (partOccurrenceId !== undefined) {
      targets.push({ kind: "element", partOccurrenceId, elementId: 1 });
    }
  }
  return {
    empty,
    active: setTargetsSelected(empty, targets, true),
    selectionTargetCount: targets.length,
  };
}

function sync(fixture: Fixture, interaction: OperationState["active"]): void {
  fixture.attachment.updateInstances(fixture.runtime, interaction, [0], fixture.bundle);
  fixture.attachment.updateElements(
    fixture.runtime,
    interaction,
    fixture.bundle,
    fixture.scene.parts,
    [0],
  );
}

function assertWrittenParts(fixture: Fixture, writes: readonly RecordedWrite[]): void {
  const ownedBuffers = new Set<GPUBuffer>();
  for (const partId of fixture.attachment.layout?.partOrder ?? []) {
    for (const buffer of partBuffers(fixture, partId)) ownedBuffers.add(buffer);
  }
  expect(writes.every((write) => ownedBuffers.has(write.buffer))).toBe(true);
  const ids = writtenPartIds(fixture, writes);
  expect(ids).toEqual([fixture.targetPartId]);
}

function writtenPartIds(fixture: Fixture, writes: readonly RecordedWrite[]): PartId[] {
  const writeBuffers = new Set(writes.map((write) => write.buffer));
  const ids: PartId[] = [];
  for (const partId of fixture.attachment.layout?.partOrder ?? []) {
    if (partBuffers(fixture, partId).some((buffer) => writeBuffers.has(buffer))) ids.push(partId);
  }
  return ids;
}

function partBuffers(fixture: Fixture, partId: PartId): GPUBuffer[] {
  const buffers: GPUBuffer[] = [];
  const storage = fixture.bundle.draw.storages.get(partId);
  if (storage !== undefined) {
    buffers.push(storage.buffer, storage.orderBuffer, storage.highlight.buffer);
    for (const sidecar of [
      storage.sidecars.transparent,
      storage.sidecars.selection,
      storage.sidecars.nodeSelection,
      storage.sidecars.edge,
      storage.sidecars.node,
    ]) {
      if (sidecar !== undefined) buffers.push(sidecar.buffer);
    }
  }
  for (const resource of fixture.bundle.draw.primitiveParts.get(partId)?.values() ?? []) {
    buffers.push(resource.vertexBuffer, resource.facePickIdsBuffer);
    if (resource.indexBuffer !== undefined) buffers.push(resource.indexBuffer);
  }
  for (const entries of fixture.bundle.draw.visibilitySkins.get(partId)?.entries.values() ?? []) {
    for (const entry of entries) buffers.push(entry.skin.indexBuffer);
  }
  return buffers;
}

function summarizeCalls(calls: readonly { readonly instanceCount: number }[]): {
  readonly calls: number;
  readonly instances: number;
} {
  return {
    calls: calls.length,
    instances: calls.reduce((total, call) => total + call.instanceCount, 0),
  };
}

function bytesWrittenTo(writes: readonly RecordedWrite[], buffer: GPUBuffer | undefined): number {
  if (buffer === undefined) return 0;
  return writes.reduce(
    (total, write) => total + (write.buffer === buffer ? write.bytes.byteLength : 0),
    0,
  );
}
