import type { Camera } from "../../camera/camera";
import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { RendererAttachment } from "../attachment";
import type { RendererResultSnapshot } from "../attachment/part-revision-results";
import { syncOrientationGlyphs } from "../orientation-glyphs/orientation-glyph";
import type { GpuDeviceLifecycle } from "../recovery";
import type { SectionCapController } from "../section-cap-controller";
import { syncResultColors } from "../resources/result-colors";
import { syncDeformations } from "./deformation";
import { encodeVisibleFrame, type FrameOptions } from "./frame";

/** Private renderer state consumed by the extracted frame path. */
export interface RendererFrameHost {
  readonly attachment: RendererAttachment;
  readonly sectionCaps: SectionCapController;
  readonly picking: { invalidate(): void };
  readonly lifecycle: GpuDeviceLifecycle;
  sourceParts: ReadonlyMap<PartId, Part> | undefined;
  parts: Map<PartId, Part>;
  lastCamera: Camera | undefined;
  results: RendererResultSnapshot | undefined;
  originTriadNominalScale: number;
  interaction: InteractionState;
  interactionNeedsRecoverySync: boolean;
  ensureSectionCaps(runtime: PackedSceneRuntime): void;
  frameOptions(): FrameOptions;
}

/** Synchronizes one renderer frame while retaining facade state ownership. */
export function renderRendererFrame(
  host: RendererFrameHost,
  runtime: PackedSceneRuntime,
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  originTriadNominalScale: number,
): void {
  const bundle = host.lifecycle.bundle;
  bundle.draw.cost.reset();
  host.originTriadNominalScale = originTriadNominalScale;
  const partsChanged = host.sourceParts !== parts;
  const cameraChanged = host.lastCamera !== camera;
  host.lastCamera = camera;
  if (partsChanged) {
    host.sourceParts = parts;
    host.parts = new Map(parts);
    host.attachment.prepareParts(parts, bundle);
    host.sectionCaps.invalidate();
  }
  const attachmentChanged = host.attachment.attach(runtime, bundle);
  if (attachmentChanged) {
    host.sectionCaps.invalidate();
    if (host.interactionNeedsRecoverySync) {
      host.attachment.updateElements(runtime, host.interaction, bundle, host.parts);
      host.interactionNeedsRecoverySync = false;
    }
  }
  const layout = host.attachment.layout;
  if (layout === undefined) throw new Error("Renderer attachment layout is unavailable");
  syncDeformations(bundle.draw, host.results?.deformation, runtime, layout);
  host.ensureSectionCaps(runtime);
  syncResultColors(bundle.draw, host.results?.colors, runtime, layout, new Set(parts.keys()));
  const capFrame = host.sectionCaps.currentFrame;
  if (capFrame !== undefined) {
    syncResultColors(
      bundle.draw,
      capFrame.resultColors,
      runtime,
      layout,
      new Set(capFrame.parts.keys()),
    );
  }
  syncOrientationGlyphs(bundle.draw.orientationGlyphs, host.results?.glyphs, runtime, layout);
  if (partsChanged || cameraChanged || attachmentChanged) host.picking.invalidate();
  encodeVisibleFrame(camera, parts, host.frameOptions());
}
