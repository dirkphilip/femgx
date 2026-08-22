import { vertexLayout } from "../resources/foundation";

type InstancedPrimitiveKind = "triangles" | "lines" | "points";

const TRIANGLE_PRIMITIVE = {
  topology: "triangle-list",
  cullMode: "none",
} satisfies GPUPrimitiveState;

const PRIMITIVE_GEOMETRY = {
  triangles: {
    vertexEntry: "vertexMain",
    vertexBuffers: [],
    primitive: TRIANGLE_PRIMITIVE,
  },
  lines: {
    vertexEntry: "vertexMain",
    vertexBuffers: [vertexLayout],
    primitive: TRIANGLE_PRIMITIVE,
  },
  points: {
    vertexEntry: "pointVertexMain",
    vertexBuffers: [vertexLayout],
    primitive: TRIANGLE_PRIMITIVE,
  },
};

/** Returns the geometry contract for one instanced primitive kind. */
export function instancedPrimitiveGeometry(
  kind: InstancedPrimitiveKind,
  vertexModule: GPUShaderModule,
): Required<Pick<GPURenderPipelineDescriptor, "vertex" | "primitive">> {
  const definition = PRIMITIVE_GEOMETRY[kind];
  return {
    vertex: {
      module: vertexModule,
      entryPoint: definition.vertexEntry,
      buffers: definition.vertexBuffers,
    },
    primitive: definition.primitive,
  };
}
