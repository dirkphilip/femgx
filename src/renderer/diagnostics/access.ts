import type { DrawResources } from "../resources/draw-resources";
import { drawCostSnapshot, materializedEdgePartIds } from "./renderer-diagnostics";
import type { GpuCostSnapshot } from "./cost";
import {
  unavailableGpuTimestampSnapshot,
  type GpuTimestampRecorder,
  type GpuTimestampSnapshot,
} from "./timestamps";

interface RendererDiagnosticsOptions {
  readonly ensureAlive: () => void;
  readonly draw: () => DrawResources;
  readonly timestampRecorder: () => GpuTimestampRecorder | undefined;
}

/** Groups renderer-private diagnostics without widening the public renderer contract. */
export interface RendererDiagnostics {
  costSnapshot(): GpuCostSnapshot;
  materializedEdgePartIds(): ReadonlySet<number>;
  timestampSnapshot(): GpuTimestampSnapshot;
  drainTimestampSamples(): Promise<void>;
}

/** Creates diagnostics that always read the renderer's current device generation. */
export function createRendererDiagnostics(
  options: RendererDiagnosticsOptions,
): RendererDiagnostics {
  return {
    costSnapshot(): GpuCostSnapshot {
      options.ensureAlive();
      return drawCostSnapshot(options.draw().cost);
    },
    materializedEdgePartIds(): ReadonlySet<number> {
      options.ensureAlive();
      return materializedEdgePartIds(options.draw());
    },
    timestampSnapshot(): GpuTimestampSnapshot {
      options.ensureAlive();
      return options.timestampRecorder()?.snapshot() ?? unavailableGpuTimestampSnapshot();
    },
    async drainTimestampSamples(): Promise<void> {
      options.ensureAlive();
      await options.timestampRecorder()?.drain();
    },
  };
}
