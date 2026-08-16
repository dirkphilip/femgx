import { viewProjectionMatrix, type Camera } from "../../camera/camera";
import { add, cross, normalize, scale, subtract, type Vec3 } from "../../math/vec3";
import { writeDeformationUniform } from "./deformation";
import { writeSectionPlaneUniform } from "./section-plane";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import type { DeformationState } from "../../results/deform";
import type { SectionPlane } from "../../math/section-plane";
import { nodeSizeDevicePixels, pointSizeDevicePixels } from "./sizes";

interface FrameUniformOptions {
  readonly canvas: HTMLCanvasElement;
  readonly device: GPUDevice;
  readonly draw: { readonly cost: GpuCostAccumulator };
  readonly resources: {
    readonly cameraBuffer: GPUBuffer;
    readonly deformationBuffer: GPUBuffer;
    readonly sectionPlaneBuffer: GPUBuffer;
  };
  readonly pointSize: number;
  readonly nodeSize: number;
  readonly devicePixelRatio: number;
  readonly deformation: DeformationState | undefined;
  readonly sectionPlane: SectionPlane | undefined;
}

/** Returns the world-space key direction for a fixed upper-left camera-space light. */
export function cameraKeyLightDirection(camera: Camera): Vec3 {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  return normalize(add(add(scale(right, -0.5), scale(up, 1)), scale(forward, -0.4)));
}

/** Returns the normalized world-space direction from the camera toward the scene. */
export function cameraViewDirection(camera: Camera): Vec3 {
  return normalize(subtract(camera.position, camera.target));
}

/** Writes camera, deformation, and section-plane uniforms for one pass. */
export function writeFrameUniforms(camera: Camera, frame: FrameUniformOptions): void {
  const uniform = new Float32Array(32);
  uniform.set(viewProjectionMatrix(camera), 0);
  uniform[16] = frame.canvas.width;
  uniform[17] = frame.canvas.height;
  uniform[18] = pointSizeDevicePixels(frame.pointSize, frame.devicePixelRatio);
  uniform[19] = nodeSizeDevicePixels(frame.nodeSize, frame.devicePixelRatio);
  uniform[20] = frame.devicePixelRatio;
  uniform[21] = 8;
  uniform[22] = 8 * frame.devicePixelRatio;
  uniform.set(cameraKeyLightDirection(camera), 24);
  uniform.set(cameraViewDirection(camera), 28);
  frame.device.queue.writeBuffer(frame.resources.cameraBuffer, 0, uniform);
  frame.draw.cost.write("uniform", uniform.byteLength);
  writeDeformationUniform(
    frame.device,
    frame.resources.deformationBuffer,
    frame.deformation,
    frame.draw.cost,
  );
  writeSectionPlaneUniform(
    frame.device,
    frame.resources.sectionPlaneBuffer,
    frame.sectionPlane,
    frame.draw.cost,
  );
}
