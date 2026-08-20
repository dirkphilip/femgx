import { WgslReflect, type StructInfo } from "wgsl_reflect";

import {
  EMISSIVE_BYTE_OFFSET,
  INSTANCE_STRIDE,
  LINE_WIDTH_BYTE_OFFSET,
} from "@/renderer/resources/draw-resources";

import { ELEMENT_RECORD_STRIDE, HIGHLIGHT_HEADER } from "@/renderer/resources/element-resources";

import { CAMERA_UNIFORM_SIZE } from "@/renderer/frame/pipelines";

import { DEFORMATION_UNIFORM_SIZE } from "@/renderer/frame/deformation";

import {
  colorFragmentShader,
  edgeFragmentShader,
  surfaceLightingFunction,
  triangleColorFragmentShader,
  vertexOutput,
} from "@/renderer/shaders/scene";

import { edgeVertexShader } from "@/renderer/shaders/edge";

import {
  instanceVertexShader,
  lineSelectionVertexShader,
  lineVertexShader,
  pointVertexShader,
  selectionVertexShader,
} from "@/renderer/shaders/instanced";

import {
  lineNodePickVertexShader,
  nodePickFragmentShader,
  nodePickVertexShader,
  pointNodePickVertexShader,
} from "@/renderer/picking/node-pick";

import { nodeOverlayFragmentShader } from "@/renderer/shaders/node-overlay";

import { edgePickFragmentShader, edgePickVertexShader } from "@/renderer/edges/edge-pick";

import {
  transparencyFragmentShader,
  triangleTransparencyFragmentShader,
} from "@/renderer/frame/transparency";

import {
  minimalTriangleColorFragmentShader,
  minimalTriangleTransparencyFragmentShader,
  minimalTriangleVertexShader,
} from "@/renderer/shaders/minimal";

import {
  selectionFragmentShader,
  selectionTransparencyFragmentShader,
} from "@/renderer/selection/selection";

/** Shared renderer test helper. */
export function normalizedDerivativeNormal(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): readonly [number, number, number] | undefined {
  const firstScale = Math.max(...first.map(Math.abs));
  const secondScale = Math.max(...second.map(Math.abs));
  if (
    !Number.isFinite(firstScale) ||
    !Number.isFinite(secondScale) ||
    firstScale <= 0 ||
    secondScale <= 0
  ) {
    return undefined;
  }
  const a = first.map((value) => value / firstScale) as [number, number, number];
  const b = second.map((value) => value / secondScale) as [number, number, number];
  const normal: [number, number, number] = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const normalLength = Math.hypot(...normal);
  return Number.isFinite(normalLength) && normalLength > 1e-6
    ? (normal.map((value) => value / normalLength) as [number, number, number])
    : undefined;
}

/** Shared renderer test helper. */
export function viewFacingSurfaceLighting(
  normal: readonly [number, number, number] | undefined,
  baseColor: readonly [number, number, number],
  light: readonly [number, number, number],
  viewer: readonly [number, number, number],
): readonly [number, number, number] {
  const ambient = 0.55;
  const diffuseCoefficient = 0.35;
  const specularStrength = 0.14;
  const exponent = 48;
  if (normal === undefined) {
    return [baseColor[0] * ambient, baseColor[1] * ambient, baseColor[2] * ambient];
  }
  const unit = (value: readonly [number, number, number]): typeof value => {
    const length = Math.hypot(...value);
    return length > 1e-6 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 0];
  };
  const unitLight = unit(light);
  const unitViewer = unit(viewer);
  const half = unit([
    unitLight[0] + unitViewer[0],
    unitLight[1] + unitViewer[1],
    unitLight[2] + unitViewer[2],
  ]);
  const facesViewer =
    normal[0] * unitViewer[0] + normal[1] * unitViewer[1] + normal[2] * unitViewer[2] >= 0;
  const facingNormal = facesViewer ? normal : normal.map((value) => -value);
  const response = Math.max(
    0,
    facingNormal[0] * unitLight[0] +
      facingNormal[1] * unitLight[1] +
      facingNormal[2] * unitLight[2],
  );
  const halfResponse = Math.max(
    0,
    facingNormal[0] * half[0] + facingNormal[1] * half[1] + facingNormal[2] * half[2],
  );
  const diffuse = ambient + diffuseCoefficient * Math.min(1, response);
  const specular =
    response > 0 && Math.hypot(...half) > 0
      ? specularStrength * Math.pow(Math.min(1, halfResponse), exponent)
      : 0;
  return [
    baseColor[0] * diffuse + specular,
    baseColor[1] * diffuse + specular,
    baseColor[2] * diffuse + specular,
  ];
}

/** Shared renderer test helper. */
export function structInfo(source: string, name: string): StructInfo {
  const info = new WgslReflect(source).getStructInfo(name);
  if (info === null) throw new Error(`struct ${name} not found in shader`);
  return info;
}

/** Shared renderer test helper. */
export function memberOffsets(info: StructInfo): ReadonlyMap<string, number> {
  return new Map(info.members.map((member) => [member.name, member.offset]));
}

export const vertexShaders = [
  ["instanceVertexShader", instanceVertexShader],
  ["lineVertexShader", lineVertexShader],
  ["pointVertexShader", pointVertexShader],
  ["edgeVertexShader", edgeVertexShader],
] as const;

export {
  WgslReflect,
  type StructInfo,
  EMISSIVE_BYTE_OFFSET,
  INSTANCE_STRIDE,
  LINE_WIDTH_BYTE_OFFSET,
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  CAMERA_UNIFORM_SIZE,
  DEFORMATION_UNIFORM_SIZE,
  colorFragmentShader,
  edgeFragmentShader,
  surfaceLightingFunction,
  triangleColorFragmentShader,
  vertexOutput,
  edgeVertexShader,
  instanceVertexShader,
  lineSelectionVertexShader,
  lineVertexShader,
  pointVertexShader,
  selectionVertexShader,
  lineNodePickVertexShader,
  nodePickFragmentShader,
  nodePickVertexShader,
  pointNodePickVertexShader,
  nodeOverlayFragmentShader,
  edgePickFragmentShader,
  edgePickVertexShader,
  transparencyFragmentShader,
  triangleTransparencyFragmentShader,
  minimalTriangleColorFragmentShader,
  minimalTriangleTransparencyFragmentShader,
  minimalTriangleVertexShader,
  selectionFragmentShader,
  selectionTransparencyFragmentShader,
};
