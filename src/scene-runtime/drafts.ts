import { identity, multiply, type Mat4 } from "../math/mat4";
import type { Assembly, PartPlacement } from "../scene/assembly";
import type { Scene } from "../scene/scene";
import type { AssemblyId, PartId } from "../scene/types";

/** Mutable intermediate for a compiled assembly expansion. */
export interface NodeDraft {
  readonly assemblyId: AssemblyId;
  readonly parent: number;
  firstChild: number;
  nextSibling: number;
  lastChild: number;
  readonly instanceStart: number;
  instanceEnd: number;
  readonly visible: 0 | 1;
  readonly effective: 0 | 1;
  readonly local: Mat4;
  readonly world: Mat4;
}

/** Mutable intermediate for a part placement, including its placement path. */
export interface InstanceDraft {
  readonly partId: PartId;
  readonly owningNode: number;
  readonly partVisible: 0 | 1;
  readonly effective: 0 | 1;
  readonly local: Mat4;
  readonly world: Mat4;
  readonly instanceId: string;
}

function linkChild(nodes: NodeDraft[], parent: number, nodeIndex: number): void {
  const parentNode = nodes[parent];
  if (parentNode === undefined) {
    return;
  }
  if (parentNode.firstChild === -1) {
    parentNode.firstChild = nodeIndex;
  } else {
    const previousSibling = nodes[parentNode.lastChild];
    if (previousSibling !== undefined) {
      previousSibling.nextSibling = nodeIndex;
    }
  }
  parentNode.lastChild = nodeIndex;
}

/** Walks an authoring scene and emits draft nodes and instance placements. */
class DraftWriter {
  readonly nodes: NodeDraft[] = [];
  readonly instances: InstanceDraft[] = [];
  private readonly assemblies: ReadonlyMap<AssemblyId, Assembly>;
  private readonly visibleAssemblyIds: ReadonlySet<AssemblyId>;
  private readonly visiblePartIds: ReadonlySet<PartId>;

  public constructor(scene: Scene) {
    this.assemblies = scene.assemblies;
    this.visibleAssemblyIds = scene.visibleAssemblyIds;
    this.visiblePartIds = scene.visiblePartIds;
  }

  /** Pushes the draft record for a part placement. */
  public pushPart(
    nodeIndex: number,
    placement: PartPlacement,
    world: Mat4,
    path: string,
    effective: 0 | 1,
  ): void {
    const partVisible: 0 | 1 = this.visiblePartIds.has(placement.partId) ? 1 : 0;
    this.instances.push({
      partId: placement.partId,
      owningNode: nodeIndex,
      partVisible,
      effective: effective === 1 && partVisible === 1 ? 1 : 0,
      local: placement.transform,
      world,
      instanceId: path,
    });
  }

  /** Compiles one assembly expansion and recurses into its placements. */
  public walk(
    assemblyId: AssemblyId,
    parent: number,
    local: Mat4,
    world: Mat4,
    path: string,
  ): void {
    const assembly = this.assemblies.get(assemblyId);
    if (assembly === undefined) {
      return;
    }
    const nodeIndex = this.nodes.length;
    const parentEffective: 0 | 1 = parent === -1 ? 1 : (this.nodes[parent]?.effective ?? 1);
    const visible: 0 | 1 = this.visibleAssemblyIds.has(assemblyId) ? 1 : 0;
    const effective: 0 | 1 = visible === 1 && parentEffective === 1 ? 1 : 0;
    const node: NodeDraft = {
      assemblyId,
      parent,
      firstChild: -1,
      nextSibling: -1,
      lastChild: -1,
      instanceStart: this.instances.length,
      instanceEnd: -1,
      visible,
      effective,
      local,
      world,
    };
    this.nodes.push(node);
    if (parent !== -1) {
      linkChild(this.nodes, parent, nodeIndex);
    }
    for (let index = 0; index < assembly.placements.length; index++) {
      const placement = assembly.placements[index];
      if (placement === undefined) {
        continue;
      }
      const placementWorld = multiply(world, placement.transform);
      const placementPath = `${path}/${index}`;
      if (placement.kind === "part") {
        this.pushPart(nodeIndex, placement, placementWorld, placementPath, effective);
      } else {
        this.walk(
          placement.assemblyId,
          nodeIndex,
          placement.transform,
          placementWorld,
          placementPath,
        );
      }
    }
    node.instanceEnd = this.instances.length;
  }
}

/**
 * Compiles an authoring scene into draft nodes and instances, threading the
 * same placement paths `flattenAssembly` derives so slots stay resolvable.
 */
export function buildSceneDrafts(scene: Scene): {
  nodes: NodeDraft[];
  instances: InstanceDraft[];
} {
  const writer = new DraftWriter(scene);
  writer.walk(scene.rootAssemblyId, -1, identity(), identity(), String(scene.rootAssemblyId));
  return { nodes: writer.nodes, instances: writer.instances };
}
