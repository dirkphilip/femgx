import { vertexLayout } from "../resources/foundation";

type InstancedPrimitiveKind = "triangles" | "lines" | "points";

interface PrimitiveGeometryDefinition {
  readonly vertexEntry: string;
  readonly vertexBuffers: GPUVertexBufferLayout[];
  readonly primitive: GPUPrimitiveState;
  readonly depthCompare: GPUCompareFunction;
}

const TRIANGLE_PRIMITIVE = {
  topology: "triangle-list",
  cullMode: "none",
} satisfies GPUPrimitiveState;

const PRIMITIVE_GEOMETRY = {
  triangles: {
    vertexEntry: "vertexMain",
    vertexBuffers: [],
    primitive: TRIANGLE_PRIMITIVE,
    depthCompare: "less",
  },
  lines: {
    vertexEntry: "vertexMain",
    vertexBuffers: [vertexLayout],
    primitive: TRIANGLE_PRIMITIVE,
    depthCompare: "less-equal",
  },
  points: {
    vertexEntry: "pointVertexMain",
    vertexBuffers: [vertexLayout],
    primitive: TRIANGLE_PRIMITIVE,
    depthCompare: "less-equal",
  },
} satisfies Record<InstancedPrimitiveKind, PrimitiveGeometryDefinition>;

/** Returns the geometry contract for one instanced primitive kind. */
export function instancedPrimitiveGeometry(
  kind: InstancedPrimitiveKind,
  vertexModule: GPUShaderModule,
): {
  readonly vertex: GPUVertexState;
  readonly primitive: GPUPrimitiveState;
  readonly depthCompare: GPUCompareFunction;
} {
  const definition = PRIMITIVE_GEOMETRY[kind];
  return {
    vertex: {
      module: vertexModule,
      entryPoint: definition.vertexEntry,
      buffers: definition.vertexBuffers,
    },
    primitive: definition.primitive,
    depthCompare: definition.depthCompare,
  };
}
