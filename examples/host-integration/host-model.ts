import {
  IoError,
  createElementModelFromFemModel,
  createModelBuilder,
  createResultFieldFromModelResult,
  validateModel,
  type FemModel,
  type Issue,
  type ModelResultField,
} from "femgx/io";
import {
  ElementShape,
  elementPart,
  topologyFor,
  type Body,
  type ElementModel,
  type ElementShape as ElementShapeType,
} from "femgx/model";
import type { ScalarField, VectorField } from "femgx/results";

interface HostNode {
  readonly id: string;
  readonly xyz: readonly [number, number, number];
}

interface HostElement {
  readonly id: number;
  readonly shape: ElementShapeType;
  readonly nodeIds: readonly string[];
  readonly bodyId: number;
}

interface HostBody {
  readonly id: number;
  readonly name: string;
}

interface HostResultCase {
  readonly stressByElementId: ReadonlyMap<number, number>;
  readonly displacementByNodeId: ReadonlyMap<string, readonly [number, number, number]>;
}

interface HostModel {
  readonly nodes: readonly HostNode[];
  readonly elements: readonly HostElement[];
  readonly bodies: readonly HostBody[];
  readonly baseline: HostResultCase;
  readonly overloaded: HostResultCase;
}

/** Dense model data and host-identity maps retained by the application. */
export interface IngestedHostModel {
  readonly model: FemModel;
  readonly elementModel: ElementModel;
  readonly part: ReturnType<typeof elementPart>;
  readonly nodeHostIdsByOrdinal: readonly string[];
  readonly baselineStress: ScalarField<"elemental">;
  readonly baselineDisplacement: VectorField<"nodal">;
  readonly overloadedStress: ScalarField<"elemental">;
  readonly overloadedDisplacement: VectorField<"nodal">;
  readonly baseline: HostResultCase;
  readonly overloaded: HostResultCase;
  readonly issues: readonly Issue[];
}

interface DenseNodes {
  readonly ids: Uint32Array;
  readonly coordinates: Float64Array;
  readonly hostIdsByOrdinal: readonly string[];
  readonly ordinalByHostId: ReadonlyMap<string, number>;
}

interface ResultSources {
  readonly stress: ModelResultField;
  readonly displacement: ModelResultField;
}

const HOST_MODEL: HostModel = {
  nodes: [
    { id: "N-100", xyz: [-1, -1, 0] },
    { id: "N-220", xyz: [0, -1, 0] },
    { id: "N-305", xyz: [1, -1, 0] },
    { id: "N-410", xyz: [-1, 1, 0] },
    { id: "N-550", xyz: [0, 1, 0] },
    { id: "N-900", xyz: [1, 1, 0] },
  ],
  elements: [
    {
      id: 1001,
      shape: ElementShape.Quad,
      nodeIds: ["N-100", "N-220", "N-550", "N-410"],
      bodyId: 10,
    },
    {
      id: 1002,
      shape: ElementShape.Quad,
      nodeIds: ["N-220", "N-305", "N-900", "N-550"],
      bodyId: 20,
    },
  ],
  bodies: [
    { id: 10, name: "left panel" },
    { id: 20, name: "right panel" },
  ],
  baseline: {
    stressByElementId: new Map([
      [1001, 120],
      [1002, 180],
    ]),
    displacementByNodeId: new Map([
      ["N-100", [0, 0, 0]],
      ["N-220", [0, 0, 0.02]],
      ["N-305", [0, 0, 0.04]],
      ["N-410", [0, 0, 0]],
      ["N-550", [0, 0, 0.02]],
      ["N-900", [0, 0, 0.04]],
    ]),
  },
  overloaded: {
    stressByElementId: new Map([
      [1001, 220],
      [1002, 300],
    ]),
    displacementByNodeId: new Map([
      ["N-100", [0, 0, 0]],
      ["N-220", [0, 0, 0.06]],
      ["N-305", [0, 0, 0.12]],
      ["N-410", [0, 0, 0]],
      ["N-550", [0, 0, 0.06]],
      ["N-900", [0, 0, 0.12]],
    ]),
  },
};

/** Converts host identities once, then hands dense typed tables to FemGx. */
export function ingestHostModel(onDiagnostic: (issue: Issue) => void): IngestedHostModel {
  const nodes = denseNodes(HOST_MODEL.nodes);
  const builder = createModelBuilder();
  builder.appendNodes(nodes.ids, nodes.coordinates);
  appendElementBlocks(builder, HOST_MODEL, nodes.ordinalByHostId);
  const bodies = modelBodies(HOST_MODEL);
  for (const body of bodies)
    builder.addSet("element", body.name ?? String(body.id), body.elementIds);
  const baselineSources = resultSources(HOST_MODEL, HOST_MODEL.baseline, nodes);
  builder.addResult(baselineSources.stress);
  builder.addResult(baselineSources.displacement);
  const model = builder.build();
  const issues = validateModel(model);
  for (const issue of issues) onDiagnostic(issue);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) throw new IoError("Host model validation failed", errors);
  const overloadedSources = resultSources(HOST_MODEL, HOST_MODEL.overloaded, nodes);
  const elementModel = createElementModelFromFemModel(model, { bodies });
  return {
    model,
    elementModel,
    part: elementPart(100, elementModel),
    nodeHostIdsByOrdinal: nodes.hostIdsByOrdinal,
    baselineStress: scalarField(model, baselineSources.stress, "stress-baseline"),
    baselineDisplacement: vectorField(model, baselineSources.displacement, "disp-baseline"),
    overloadedStress: scalarField(model, overloadedSources.stress, "stress-overloaded"),
    overloadedDisplacement: vectorField(model, overloadedSources.displacement, "disp-overloaded"),
    baseline: HOST_MODEL.baseline,
    overloaded: HOST_MODEL.overloaded,
    issues,
  };
}

function denseNodes(nodes: readonly HostNode[]): DenseNodes {
  const ids = new Uint32Array(nodes.length);
  const coordinates = new Float64Array(nodes.length * 3);
  const hostIdsByOrdinal: string[] = [];
  const ordinalByHostId = new Map<string, number>();
  for (let ordinal = 0; ordinal < nodes.length; ordinal += 1) {
    const node = required(nodes[ordinal], `node row ${ordinal}`);
    if (ordinalByHostId.has(node.id)) throw new Error(`Duplicate host node ${node.id}`);
    ids[ordinal] = ordinal;
    coordinates.set(node.xyz, ordinal * 3);
    hostIdsByOrdinal.push(node.id);
    ordinalByHostId.set(node.id, ordinal);
  }
  return { ids, coordinates, hostIdsByOrdinal, ordinalByHostId };
}

function appendElementBlocks(
  builder: ReturnType<typeof createModelBuilder>,
  host: HostModel,
  ordinalByHostId: ReadonlyMap<string, number>,
): void {
  const bodyIds = new Set(host.bodies.map((body) => body.id));
  const blocks = new Map<ElementShapeType, { ids: number[]; connectivity: number[] }>();
  for (const element of host.elements) {
    if (!bodyIds.has(element.bodyId)) throw new Error(`Unknown host body ${element.bodyId}`);
    const block = blocks.get(element.shape) ?? { ids: [], connectivity: [] };
    if (element.nodeIds.length !== topologyFor(element.shape).nodeCount) {
      throw new Error(`Element ${element.id} has the wrong connectivity size`);
    }
    block.ids.push(element.id);
    for (const hostNodeId of element.nodeIds) {
      block.connectivity.push(required(ordinalByHostId.get(hostNodeId), `host node ${hostNodeId}`));
    }
    blocks.set(element.shape, block);
  }
  for (const [shape, block] of blocks) {
    builder.openElementShapeBlock(shape);
    builder.appendElements(block.ids, block.connectivity);
  }
}

function modelBodies(host: HostModel): readonly Body[] {
  return host.bodies.map((body) => ({
    id: body.id,
    name: body.name,
    elementIds: host.elements
      .filter((element) => element.bodyId === body.id)
      .map((element) => element.id)
      .sort((left, right) => left - right),
  }));
}

function resultSources(host: HostModel, result: HostResultCase, nodes: DenseNodes): ResultSources {
  const elementIds = Uint32Array.from(host.elements, (element) => element.id);
  const stressValues = Float64Array.from(host.elements, (element) =>
    required(result.stressByElementId.get(element.id), `stress for element ${element.id}`),
  );
  const displacementValues = new Float64Array(nodes.ids.length * 3);
  for (let ordinal = 0; ordinal < nodes.hostIdsByOrdinal.length; ordinal += 1) {
    const hostId = required(nodes.hostIdsByOrdinal[ordinal], `host id at node ${ordinal}`);
    const value = required(result.displacementByNodeId.get(hostId), `displacement for ${hostId}`);
    displacementValues.set(value, ordinal * 3);
  }
  return {
    stress: {
      name: "von Mises stress",
      location: "element",
      components: 1,
      ids: elementIds,
      values: stressValues,
    },
    displacement: {
      name: "displacement",
      location: "node",
      components: 3,
      ids: nodes.ids,
      values: displacementValues,
    },
  };
}

function scalarField(
  model: FemModel,
  source: ModelResultField,
  id: string,
): ScalarField<"elemental"> {
  const field = createResultFieldFromModelResult(model, source, {
    id,
    unit: "MPa",
    shape: "scalar",
  });
  if (field.location !== "elemental") throw new Error("Expected elemental stress");
  return field;
}

function vectorField(model: FemModel, source: ModelResultField, id: string): VectorField<"nodal"> {
  return createResultFieldFromModelResult(model, source, { id, unit: "mm", shape: "vector" });
}

function required<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}
