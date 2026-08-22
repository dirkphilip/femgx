import type { PartId } from "../../geometry/part";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import { GpuCostAccumulator } from "../diagnostics/cost";
import { syncDeformations } from "../frame/deformation";
import { syncOrientationGlyphs } from "../orientation-glyphs/orientation-glyph";
import { syncResultColors } from "../resources/result-colors";
import type { DrawResources } from "../resources/draw-resources";
import type { BufferWriteData, BufferWritePort } from "../resources/buffer-write-port";
import {
  createInstanceStorageRevisionJournal,
  type InstanceStorage,
} from "../resources/instance-storage";
import { createHighlightRevisionJournal } from "../selection/highlight-storage";
import type { InstanceLayout } from "../runtime-state";
import { PartRevisionMap } from "./part-revision-overlay";
import type { PartRevisionResultState } from "./part-revision-results";
import {
  commitDrawRevisionResources,
  discardDrawRevisionResources,
  DRAW_REVISION_SIDECARS,
  type DrawRevisionKind,
} from "./prepared-draw-revision-resources";
import { stagePartRevisionSidecars } from "./part-revision-storage";

interface PreparedDrawRevisionOptions {
  readonly live: DrawResources;
  readonly staged: DrawResources;
  readonly affectedPartIds: ReadonlySet<PartId>;
  readonly replacedPartIds: ReadonlySet<PartId>;
  readonly kind: DrawRevisionKind;
  readonly writes: readonly StagedBufferWrite[];
}

/** Owns one detached draw revision from sparse staging through commit or discard. */
export class PreparedDrawRevision {
  public readonly draw: DrawResources;
  public readonly affectedPartIds: ReadonlySet<PartId>;
  public readonly replacedPartIds: ReadonlySet<PartId>;
  private readonly live: DrawResources;
  private readonly writes: readonly StagedBufferWrite[];
  private readonly kind: DrawRevisionKind;
  private resultState: PartRevisionResultState | undefined;
  private resultsStaged = false;
  private lifecycle: "pending" | "committing" | "committed" | "discarded" | "failed" = "pending";

  public constructor(options: PreparedDrawRevisionOptions) {
    this.draw = options.staged;
    this.live = options.live;
    this.affectedPartIds = options.affectedPartIds;
    this.replacedPartIds = options.replacedPartIds;
    this.kind = options.kind;
    this.writes = options.writes;
  }

  /** Stages renderer-owned result buffers against this revision's draw overlay. */
  public stageResults(
    results: PartRevisionResultState | undefined,
    runtime: PackedSceneRuntime,
    layout: InstanceLayout,
  ): void {
    this.assertPending();
    if (this.resultsStaged) throw new Error("Prepared draw results are already staged");
    this.resultsStaged = true;
    this.resultState = results;
    const staged = results?.staged;
    if (staged === undefined) return;
    if (staged.glyphs !== undefined)
      syncOrientationGlyphs(this.draw.orientationGlyphs, staged.glyphs, runtime, layout);
    if (staged.deformation !== undefined)
      syncDeformations(this.draw, staged.deformation, runtime, layout, this.affectedPartIds);
    if (staged.colors !== undefined)
      syncResultColors(this.draw, staged.colors, runtime, layout, this.affectedPartIds);
  }

  /** Publishes all owned GPU resources and deferred writes exactly once. */
  public commit(): void {
    this.assertPending();
    this.lifecycle = "committing";
    try {
      commitDrawRevisionResources({
        live: this.live,
        staged: this.draw,
        affectedPartIds: this.affectedPartIds,
        replacedPartIds: this.replacedPartIds,
        kind: this.kind,
        writes: this.writes,
        results: this.resultState,
      });
      this.live.cost.merge(this.draw.cost);
      this.live.cost.completeTransaction();
      this.lifecycle = "committed";
    } catch (error) {
      this.lifecycle = "failed";
      throw error;
    }
  }

  /** Rolls back journals and destroys only allocations owned by this revision. */
  public discard(): void {
    this.assertPending();
    discardDrawRevisionResources(this.draw, this.live, this.affectedPartIds);
    this.lifecycle = "discarded";
  }

  private assertPending(): void {
    if (this.lifecycle !== "pending") {
      throw new Error(`Prepared draw revision is already ${this.lifecycle}`);
    }
  }
}

/** A deferred write targeting a retained GPU buffer during revision staging. */
export interface StagedBufferWrite {
  readonly buffer: GPUBuffer;
  readonly offset: number;
  readonly data: Uint8Array;
}

/** Creates a write port that defers only writes targeting retained live buffers. */
export function createPartRevisionStagingWritePort(
  direct: BufferWritePort,
  protectedBuffers: ReadonlySet<GPUBuffer>,
  writes: StagedBufferWrite[],
): BufferWritePort {
  return { writeBuffer: stagedWriteBuffer(direct, protectedBuffers, writes) };
}

function stagedWriteBuffer(
  direct: BufferWritePort,
  protectedBuffers: ReadonlySet<GPUBuffer>,
  writes: StagedBufferWrite[],
) {
  return (
    buffer: GPUBuffer,
    offset: number,
    data: BufferWriteData,
    dataOffset?: number,
    size?: number,
  ): void => {
    if (protectedBuffers.has(buffer)) {
      writes.push({ buffer, offset, data: copyWriteData(data, dataOffset, size) });
      return;
    }
    direct.writeBuffer(buffer, offset, data, dataOffset, size);
  };
}

function copyWriteData(
  data: BufferWriteData,
  dataOffset: number | undefined,
  size: number | undefined,
): Uint8Array {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  const elementSize =
    !ArrayBuffer.isView(data) || !("BYTES_PER_ELEMENT" in data)
      ? 1
      : typeof data.BYTES_PER_ELEMENT === "number"
        ? data.BYTES_PER_ELEMENT
        : 1;
  const startElement = dataOffset ?? 0;
  const sizeElements = size ?? bytes.byteLength / elementSize - startElement;
  validateWriteRange(startElement, sizeElements, bytes.byteLength / elementSize);
  const start = startElement * elementSize;
  return bytes.slice(start, start + sizeElements * elementSize);
}

function validateWriteRange(start: number, size: number, length: number): void {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(size) ||
    start < 0 ||
    size < 0 ||
    start > length ||
    size > length - start
  ) {
    throw new RangeError("GPUQueue.writeBuffer dataOffset and size exceed the source data");
  }
}

/** Creates one sparse draw revision without mutating its live owner. */
export function prepareDrawRevision(options: {
  readonly live: DrawResources;
  readonly affectedPartIds: ReadonlySet<PartId>;
  readonly replacedPartIds: ReadonlySet<PartId>;
  readonly stageInteraction: boolean;
  readonly kind: DrawRevisionKind;
}): PreparedDrawRevision {
  const affectedPartIds = new Set(options.affectedPartIds);
  const replacedPartIds = new Set(options.replacedPartIds);
  const writes: StagedBufferWrite[] = [];
  const protectedBuffers = protectedStorageBuffers(options.live, affectedPartIds);
  const writePort = createPartRevisionStagingWritePort(
    options.live.writePort,
    protectedBuffers,
    writes,
  );
  const staged = createStagedDraw(
    options.live,
    affectedPartIds,
    options.stageInteraction,
    writePort,
  );
  return new PreparedDrawRevision({
    live: options.live,
    staged,
    affectedPartIds,
    replacedPartIds,
    kind: options.kind,
    writes,
  });
}

function createStagedDraw(
  draw: DrawResources,
  partIds: ReadonlySet<PartId>,
  stageInteraction: boolean,
  writePort: DrawResources["writePort"],
): DrawResources {
  const cost = new GpuCostAccumulator();
  return {
    ...draw,
    writePort,
    deferReleases: true,
    cost,
    parts: new PartRevisionMap(draw.parts),
    primitiveParts: new PartRevisionMap(draw.primitiveParts),
    nodeParts: new PartRevisionMap(draw.nodeParts),
    storages: stagedStorages(draw.storages, partIds, stageInteraction),
    visibilitySkins: new PartRevisionMap(draw.visibilitySkins),
    admissionCache: new PartRevisionMap(draw.admissionCache),
    deformations: new Map(),
    resultColors: new Map(),
    orientationGlyphs: {
      ...draw.orientationGlyphs,
      writePort,
      cost,
      paramsData: draw.orientationGlyphs.paramsData.slice(0),
      parts: new Map(),
    },
  };
}

function stagedStorages(
  source: ReadonlyMap<PartId, InstanceStorage>,
  partIds: ReadonlySet<PartId>,
  stageInteraction: boolean,
): Map<PartId, InstanceStorage> {
  const staged = new PartRevisionMap(source);
  if (!stageInteraction) return staged;
  for (const partId of partIds) {
    const storage = source.get(partId);
    if (storage !== undefined) staged.set(partId, cloneStagedStorage(storage));
  }
  return staged;
}

function cloneStagedStorage(storage: InstanceStorage): InstanceStorage {
  return {
    ...storage,
    deferRelease: true,
    revisionJournal: createInstanceStorageRevisionJournal(),
    sidecars: stagePartRevisionSidecars(storage.sidecars),
    data: storage.data,
    highlight: { ...storage.highlight, revisionJournal: createHighlightRevisionJournal() },
    emphasisSlots: new Set(storage.emphasisSlots),
    edgeEmphasisSlots: new Set(storage.edgeEmphasisSlots),
    orderData: storage.orderData,
    bindGroup: undefined,
    minimalBindGroup: undefined,
    minimalTransparentBindGroup: undefined,
    nodeBindGroup: undefined,
    edgeBindGroup: undefined,
    transparentBindGroup: undefined,
    selectionBindGroup: undefined,
    subsetSelectionBindGroup: undefined,
    nodeSelectionBindGroup: undefined,
    subsetBindGroup: undefined,
    subsetTransparentBindGroup: undefined,
  };
}

function protectedStorageBuffers(
  draw: DrawResources,
  partIds: ReadonlySet<PartId>,
): Set<GPUBuffer> {
  const buffers = new Set<GPUBuffer>();
  for (const partId of partIds) {
    const storage = draw.storages.get(partId);
    if (storage === undefined) continue;
    buffers.add(storage.buffer);
    buffers.add(storage.orderBuffer);
    for (const kind of DRAW_REVISION_SIDECARS) {
      const sidecar = storage.sidecars[kind];
      if (sidecar !== undefined) buffers.add(sidecar.buffer);
    }
    if (storage.highlightOwned) buffers.add(storage.highlight.buffer);
  }
  if (draw.orientationGlyphs.paramsBuffer !== undefined) {
    buffers.add(draw.orientationGlyphs.paramsBuffer);
  }
  return buffers;
}
