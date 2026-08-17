import type { PartId, Primitive } from "../../geometry/part";
import type { DeformationStorage } from "../frame/deformation";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import type { OrientationGlyphDrawResources } from "../orientation-glyphs/orientation-glyph";
import type { ColorTargets } from "./color-targets";
import type { HighlightStorage } from "../selection/highlight-storage";
import type { InstanceStorage } from "./instance-storage";
import type { PartResource } from "./foundation";

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
  /** Fixed device-scoped binding for inactive order sidecars. */
  readonly emptyOrderBuffer: GPUBuffer;
  /** Fixed device-scoped zero-entry emphasis binding. */
  readonly emptyHighlight: HighlightStorage;
  /** Fixed device-scoped identity displacement binding. */
  readonly emptyDeformationBuffer: GPUBuffer;
  readonly deformations: Map<PartId, DeformationStorage>;
  readonly orientationGlyphs: OrientationGlyphDrawResources;
  /** The complete visible-frame target state and its composite cache. */
  readonly targets: ColorTargets;
}
