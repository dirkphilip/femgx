import type { InteractionGranularity } from "../../src/entries/root";
import type { BoxSelectionRect } from "../../src/entries/interaction";
import type { BenchmarkCapture } from "../benchmark/capture";
import type { GlbViewportBenchmarkReport } from "../benchmark/glb-viewport";

export interface DemoHarnessOptions {
  readonly testAlphaZero: boolean;
}

export interface DemoPickProbe {
  readonly pickKey: string;
  readonly hoveredKey: string;
}

export interface DemoHarness {
  readonly destroyRenderer: () => void;
  readonly recreateRenderer: () => Promise<void>;
  readonly runBenchmark: (
    includeLarge: boolean,
    caseId?: string,
    capture?: BenchmarkCapture,
  ) => Promise<unknown>;
  readonly runGlbViewportBenchmark: (
    primitiveCount?: number,
    holdMilliseconds?: number,
  ) => Promise<GlbViewportBenchmarkReport>;
  readonly pickPoint: (x: number, y: number) => Promise<readonly number[] | undefined>;
  readonly probePick: (x: number, y: number) => Promise<DemoPickProbe>;
  readonly pickRegion: (
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ) => Promise<readonly unknown[]>;
  readonly getBoxSelectionStats: () => {
    readonly active: boolean;
    readonly queued: boolean;
    readonly started: number;
    readonly maxActive: number;
  };
}

/** Reads deterministic test-only query inputs and installs the shader failure seam. */
export function readDemoHarnessOptions(): DemoHarnessOptions {
  const query = new URLSearchParams(window.location.search);
  const shaderFailure = query.get("testShaderFailure");
  if (shaderFailure !== null) {
    (globalThis as Record<string, unknown>)["__FEMGX_TEST_SHADER_FAILURE__"] = shaderFailure;
  }
  return { testAlphaZero: query.has("testAlphaZero") };
}

/** Installs the explicitly test/developer-only lifecycle and query seam. */
export function installDemoHarness(harness: DemoHarness): void {
  (window as typeof window & { femgxDemo?: DemoHarness }).femgxDemo = harness;
}
