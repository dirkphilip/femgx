import { describe, expect, it } from "vitest";
import { createPackedTet4Part } from "../../../demo/benchmark/packed-tet4";
import { buildDenseTet4Payload } from "../../../demo/benchmark/tet4-transfer";
import { packedSemanticStorage } from "../../../src/geometry/packed/packed-semantic";
import { createInteractionState } from "../../../src/interaction/interaction";
import { updateInteractionState } from "../../../src/interaction/state";
import { identity } from "../../../src/math/mat4";
import { RendererAttachment } from "../../../src/renderer/attachment";
import { createGpuBundle, destroyGpuBundle } from "../../../src/renderer/recovery";
import { buildPackedVisibilitySkinIndices } from "../../../src/renderer/visibility/packed-skin";
import { destroyVisibilitySkinCache } from "../../../src/renderer/visibility/skins";
import type { VisibilitySignature } from "../../../src/renderer/visibility/types";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { createScene } from "../../../src/scene/scene";
import { fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";
import {
  buildOperationsReport,
  emitOperationsReport,
  type OperationSpec,
} from "../operation-report";

const CASES = ["one", "half", "all"] as const;

describe("local Tet4 element-visibility synchronization baseline", () => {
  it("emits exact packed visibility-skin construction and cache rows", async () => {
    const restore = installGpuGlobals();
    const { payload } = buildDenseTet4Payload(28);
    const part = createPackedTet4Part(1, payload);
    const packed = packedSemanticStorage(part);
    if (packed === undefined) throw new Error("Tet4 benchmark lost packed semantic storage");
    const fixture = await visibilityFixture(part, packed.elementIds);
    try {
      const operations = [
        ...visibilityOperations(packed, payload.indices.length),
        ...cacheOperations(fixture),
      ];
      const report = buildOperationsReport(operations);
      expect(report.operations).toHaveLength(CASES.length + 3);
      for (const operation of report.operations) {
        expect(operation.timingsMs.p50).toBeGreaterThanOrEqual(0);
        expect(operation.timingsMs.p95).toBeGreaterThanOrEqual(operation.timingsMs.p50);
        expect(operation.workload.details?.["faceCount"]).toBe(526_848);
      }
      emitOperationsReport(report);
    } finally {
      destroyGpuBundle(fixture.bundle);
      restore();
    }
  }, 120_000);
});

type VisibilityFixture = Awaited<ReturnType<typeof visibilityFixture>>;

async function visibilityFixture(part: ReturnType<typeof createPackedTet4Part>, ids: Uint32Array) {
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "visibility",
      placements: [{ kind: "part", placementId: "tet4", partId: part.id, transform: identity() }],
    })
    .withRoot(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
  const attachment = new RendererAttachment();
  attachment.prepareParts(scene.parts, bundle);
  attachment.attach(runtime, bundle);
  const occurrenceId = runtime.getInstanceId(0);
  if (occurrenceId === undefined) throw new Error("Tet4 visibility occurrence is missing");
  const hidden = updateInteractionState(createInteractionState(), {
    hiddenElementIds: new Map([
      [occurrenceId, new Set(ids.subarray(0, Math.floor(ids.length / 2)))],
    ]),
  });
  return { part, scene, runtime, bundle, attachment, hidden, shown: createInteractionState() };
}

function cacheOperations(fixture: VisibilityFixture): readonly OperationSpec[] {
  const details = {
    elementCount: 131_712,
    hiddenElementCount: 65_856,
    faceCount: 526_848,
    outputIndexCount: 18_816,
    outputBytes: 75_264,
  };
  return [
    cacheOperation(fixture, "cold-hide", details),
    cacheOperation(fixture, "show-destroy", details),
    cacheOperation(fixture, "rehide-recompute-full-sync", details),
  ];
}

function cacheOperation(
  fixture: VisibilityFixture,
  phase: string,
  details: Readonly<Record<string, number>>,
): OperationSpec {
  const expectsSkin = phase !== "show-destroy";
  const active = expectsSkin ? fixture.hidden : fixture.shown;
  const before = expectsSkin ? fixture.shown : fixture.hidden;
  return {
    name: `tet4-visibility-half-${phase}-fake-gpu-sync`,
    workloadUnit: "renderer visibility syncs with exact surface draw classification",
    workloadCount: 1,
    workloadDetails: {
      ...details,
      surfaceDrawCalls: 1,
      visibilitySkinDrawCalls: expectsSkin ? 1 : 0,
    },
    beforeEach: () => {
      if (phase === "cold-hide") destroyVisibilitySkinCache(fixture.bundle.draw, fixture.part.id);
      fixture.attachment.updateElements(
        fixture.runtime,
        before,
        fixture.bundle,
        fixture.scene.parts,
      );
    },
    run: () => {
      fixture.attachment.updateElements(
        fixture.runtime,
        active,
        fixture.bundle,
        fixture.scene.parts,
      );
      expect(fixture.attachment.calls).toHaveLength(1);
      expect(fixture.attachment.calls[0]?.visibilitySkin?.indexCount).toBe(
        expectsSkin ? 18_816 : undefined,
      );
      expect(fixture.bundle.draw.visibilitySkins.get(fixture.part.id)?.residentBytes).toBe(
        expectsSkin ? 75_264 : 0,
      );
    },
  };
}

function visibilityOperations(
  packed: NonNullable<ReturnType<typeof packedSemanticStorage>>,
  indexUpperBound: number,
): readonly OperationSpec[] {
  return CASES.map((id) => {
    const hiddenCount =
      id === "one" ? 1 : id === "half" ? packed.elementIds.length / 2 : packed.elementIds.length;
    const elementWords = denseElementWords(packed.elementIds.length, hiddenCount);
    const elementIds =
      elementWords === undefined
        ? Array.from(packed.elementIds.subarray(0, hiddenCount))
        : packed.elementIds.slice(0, hiddenCount);
    const signature: VisibilitySignature = {
      hash: hiddenCount,
      bodyIds: [],
      elementIds,
      ...(elementWords === undefined ? {} : { elementWords }),
      hasHidden: true,
    };
    const expectedIndexCount = buildPackedVisibilitySkinIndices(
      packed,
      signature,
      indexUpperBound,
    ).length;
    const typedSignatureBytes =
      (elementIds instanceof Uint32Array ? elementIds.byteLength : 0) +
      (elementWords?.byteLength ?? 0);
    return {
      name: `tet4-visibility-${id}-build-packed-skin-cold`,
      workloadUnit: "authored triangle faces classified into a compact visible skin",
      workloadCount: packed.faceOwnerElementOrdinals.length,
      workloadDetails: {
        elementCount: packed.elementIds.length,
        hiddenElementCount: hiddenCount,
        faceCount: packed.faceOwnerElementOrdinals.length,
        outputIndexCount: expectedIndexCount,
        outputBytes: expectedIndexCount * Uint32Array.BYTES_PER_ELEMENT,
        signatureElementIdCount: elementIds.length,
        signatureTypedBytes: typedSignatureBytes,
        signatureOrdinalWordBytes: elementWords?.byteLength ?? 0,
      },
      run: () => {
        const indices = buildPackedVisibilitySkinIndices(packed, signature, indexUpperBound);
        if (indices.length !== expectedIndexCount) throw new Error(`${id} visibility skin changed`);
      },
    };
  });
}

function denseElementWords(elementCount: number, hiddenCount: number): Uint32Array | undefined {
  const wordCount = Math.ceil(elementCount / 32);
  if (wordCount >= hiddenCount) return undefined;
  const words = new Uint32Array(wordCount);
  words.fill(0xffffffff, 0, Math.floor(hiddenCount / 32));
  const trailing = hiddenCount & 31;
  if (trailing !== 0) words[hiddenCount >> 5] = 0xffffffff >>> (32 - trailing);
  return words;
}
