import type { GpuValidationOptions } from "./diagnostics/validation";
import type { GpuTimestampRecorder } from "./diagnostics/timestamps";
import type { GpuBundle } from "./recovery";

export interface GpuRendererConstruction {
  readonly bundle: GpuBundle;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly validation: GpuValidationOptions | undefined;
  readonly timestampQueriesRequested?: boolean;
  readonly timestampRecorder?: GpuTimestampRecorder;
}
