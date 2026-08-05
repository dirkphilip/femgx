import { WebGpuUnsupportedError, type WebGpuUnsupportedReason } from "../src/index";

/**
 * Stable machine-readable phase of a WebGPU startup failure. `pick-readback`
 * is part of the classification vocabulary; the current demo does not emit it
 * because GPU pick readback is no longer probed during startup (demo
 * interaction picking is CPU raycasting).
 */
export type WebGpuStartupPhase =
  "api" | "adapter" | "device" | "renderer-setup" | "frame-submission" | "pick-readback";

/** A classified WebGPU startup failure, ready to surface in the status UI. */
export interface WebGpuStartupDiagnostic {
  readonly phase: WebGpuStartupPhase;
  /** Final status-line text; never relies on console output. */
  readonly message: string;
}

/** Maps a typed unsupported reason onto its startup phase. */
export function phaseForReason(reason: WebGpuUnsupportedReason): WebGpuStartupPhase {
  switch (reason) {
    case "no-webgpu":
      return "api";
    case "adapter-unavailable":
      return "adapter";
    case "device-unavailable":
      return "device";
  }
}

/**
 * Classifies an error thrown while starting the WebGPU renderer. `phase` names
 * the startup step that was running; a typed `WebGpuUnsupportedError` refines
 * it to the api/adapter/device stage it reports. The returned message is the
 * final status-line text.
 */
export function classifyWebGpuStartupError(
  phase: WebGpuStartupPhase,
  error: unknown,
): WebGpuStartupDiagnostic {
  if (error instanceof WebGpuUnsupportedError) {
    return { phase: phaseForReason(error.reason), message: error.message };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { phase, message: `WebGPU is unavailable: ${detail}` };
}
