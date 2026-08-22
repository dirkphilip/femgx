import type { createPackedTet4Part } from "../../../demo/benchmark/packed-tet4";
import { createInteractionState } from "@/interaction/interaction";
import { withInteractionVisibility } from "@/interaction/state";
import { identityMatrix } from "@/math/mat4";
import { RendererAttachment } from "@/renderer/attachment";
import { createGpuBundle } from "@/renderer/recovery";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";
import { fakeGpuDevice } from "../../renderer/fake-gpu";

export type VisibilityFixture = Awaited<ReturnType<typeof visibilityFixture>>;

/** Builds a fake-GPU scene and attachment for the large Tet4 visibility suites. */
export async function visibilityFixture(
  part: ReturnType<typeof createPackedTet4Part>,
  ids: Uint32Array,
) {
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "visibility",
      placements: [
        { kind: "part", placementId: "tet4", partId: part.id, transform: identityMatrix() },
      ],
    })
    .setRootAssembly(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const gpu = fakeGpuDevice();
  const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
  const attachment = new RendererAttachment();
  attachment.prepareParts(scene.parts, bundle);
  attachment.attach(runtime, bundle);
  attachment.setOverlayVisibility(true, false, bundle);
  const occurrenceId = runtime.getInstanceId(0);
  if (occurrenceId === undefined) throw new Error("Tet4 visibility occurrence is missing");
  const hidden = withInteractionVisibility(createInteractionState(), {
    hiddenBodyIds: new Map(),
    hiddenElementIds: new Map([
      [occurrenceId, new Set(ids.subarray(0, Math.floor(ids.length / 2)))],
    ]),
  });
  return {
    part,
    scene,
    runtime,
    gpu,
    bundle,
    attachment,
    hidden,
    shown: createInteractionState(),
    occurrenceId,
  };
}
