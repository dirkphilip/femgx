import type { PartId, Primitive } from "../../geometry/part";
import type { DeformationState } from "../../results/deform";
import type { SectionPlane } from "../../math/section-plane";
import type { DeformationStorage } from "../frame/deformation";
import type { GpuCostAccumulator, GpuCostAdmission } from "../diagnostics/cost";
import type { OrientationGlyphDrawResources } from "../orientation-glyphs/orientation-glyph";
import type { ColorTargets } from "./color-targets";
import type { HighlightStorage } from "../selection/highlight-storage";
import type { InstanceStorage } from "./instance-storage";
import type { PartResource } from "./foundation";
import type { VisibilitySkinCache } from "../visibility/types";
import type { ResultColorStorage } from "./result-colors";
import type { ResultColorMap } from "../../results/colors";

/** Cached state used to avoid re-evaluating unchanged feature admission. */
export interface PipelineAdmissionCacheEntry {
  readonly resultColors: ResultColorMap | undefined;
  readonly deformation: DeformationState | undefined;
  readonly sectionPlane: SectionPlane | undefined;
  readonly usesExteriorFaceSubsets: boolean;
  readonly highlightOwned: boolean;
  readonly minimalAvailable: boolean;
  readonly admission: GpuCostAdmission;
}

/** GPU resources retained by the per-part draw path. */
export interface DrawResources {
  readonly device: GPUDevice;
  readonly cost: GpuCostAccumulator;
  destroyed: boolean;
  readonly parts: Map<PartId, PartResource>;
  /** Per-primitive resources for parts that contain more than one topology. */
  readonly primitiveParts: Map<PartId, Map<Primitive, PartResource>>;
  readonly nodeParts: Map<PartId, PartResource>;
  readonly storages: Map<PartId, InstanceStorage>;
  /** Bounded compact surface skins keyed by effective body/element visibility. */
  readonly visibilitySkins: Map<PartId, VisibilitySkinCache>;
  readonly admissionCache: Map<PartId, PipelineAdmissionCacheEntry>;
  /** Fixed device-scoped binding for inactive order sidecars. */
  readonly emptyOrderBuffer: GPUBuffer;
  /** Fixed device-scoped zero-entry emphasis binding. */
  readonly emptyHighlight: HighlightStorage;
  /** Fixed device-scoped identity displacement binding. */
  readonly emptyDeformationBuffer: GPUBuffer;
  /** Fixed device-scoped inactive scalar color binding. */
  readonly emptyResultColorBuffer: GPUBuffer;
  readonly deformations: Map<PartId, DeformationStorage>;
  readonly resultColors: Map<PartId, ResultColorStorage>;
  readonly orientationGlyphs: OrientationGlyphDrawResources;
  /** The complete visible-frame target state and its composite cache. */
  readonly targets: ColorTargets;
}
