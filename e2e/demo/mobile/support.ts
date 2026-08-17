/**
 * Shared phone viewport constants and serialized camera assertions for the mobile
 * WebGPU regression files.
 */
export const PHONE = { width: 390, height: 844 };

/** Serialized camera fields used to prove touch navigation did not move. */
export interface CameraPose {
  readonly mode: string;
  readonly position: readonly number[];
  readonly target: readonly number[];
  readonly up: readonly number[];
}

/** Parses the demo canvas camera dataset into comparable pose fields. */
export function cameraPose(serialized: string | null): CameraPose {
  const camera = JSON.parse(serialized ?? "null") as CameraPose;
  return { mode: camera.mode, position: camera.position, target: camera.target, up: camera.up };
}
