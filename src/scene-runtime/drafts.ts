import { identity, multiply, type Mat4 } from "../math/mat4";
import type { Assembly, PartPlacement } from "../scene/assembly";
import type { Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyNodeId } from "../scene/types";

/** Mutable intermediate for a compiled assembly expansion. */
export interface NodeDraft {
  readonly nodeId: AssemblyNodeId;
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

  private pushNode(
    assemblyId: AssemblyId,
    parent: number,
    local: Mat4,
    world: Mat4,
    nodeId: AssemblyNodeId,
  ): number | undefined {
    if (this.assemblies.get(assemblyId) === undefined) {
      return undefined;
    }
    const parentEffective: 0 | 1 = parent === -1 ? 1 : (this.nodes[parent]?.effective ?? 1);
    const visible: 0 | 1 = this.visibleAssemblyIds.has(assemblyId) ? 1 : 0;
    const effective: 0 | 1 = visible === 1 && parentEffective === 1 ? 1 : 0;
    const nodeIndex = this.nodes.length;
    this.nodes.push({
      nodeId,
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
    });
    if (parent !== -1) {
      linkChild(this.nodes, parent, nodeIndex);
    }
    return nodeIndex;
  }

  /** Compiles every assembly expansion with an explicit depth-first stack. */
  public walk(assemblyId: AssemblyId, local: Mat4, world: Mat4, path: string): void {
    const root = this.pushNode(assemblyId, -1, local, world, path);
    if (root === undefined) {
      return;
    }
    const stack: WalkItem[] = [{ nodeIndex: root, assemblyId, world, path, nextPlacement: 0 }];
    while (stack.length > 0) {
      const item = stack[stack.length - 1];
      if (item === undefined) {
        stack.pop();
        continue;
      }
      const assembly = this.assemblies.get(item.assemblyId);
      if (assembly === undefined || item.nextPlacement >= assembly.placements.length) {
        const node = this.nodes[item.nodeIndex];
        if (node !== undefined) {
          node.instanceEnd = this.instances.length;
        }
        stack.pop();
        continue;
      }
      const placementIndex = item.nextPlacement;
      item.nextPlacement += 1;
      const placement = assembly.placements[placementIndex];
      if (placement === undefined) {
        continue;
      }
      const placementWorld = multiply(item.world, placement.transform);
      const placementPath = `${item.path}/${placementIndex}`;
      if (placement.kind === "part") {
        const node = this.nodes[item.nodeIndex];
        this.pushPart(
          item.nodeIndex,
          placement,
          placementWorld,
          placementPath,
          node?.effective ?? 0,
        );
        continue;
      }
      const child = this.pushNode(
        placement.assemblyId,
        item.nodeIndex,
        placement.transform,
        placementWorld,
        placementPath,
      );
      if (child !== undefined) {
        stack.push({
          nodeIndex: child,
          assemblyId: placement.assemblyId,
          world: placementWorld,
          path: placementPath,
          nextPlacement: 0,
        });
      }
    }
  }
}

interface WalkItem {
  readonly nodeIndex: number;
  readonly assemblyId: AssemblyId;
  readonly world: Mat4;
  readonly path: string;
  nextPlacement: number;
}

/**
 * Compiles an authoring scene into draft nodes and instances with stable
 * placement paths so slots stay resolvable.
 */
export function buildSceneDrafts(scene: Scene): {
  nodes: NodeDraft[];
  instances: InstanceDraft[];
} {
  const writer = new DraftWriter(scene);
  writer.walk(scene.rootAssemblyId, identity(), identity(), String(scene.rootAssemblyId));
  return { nodes: writer.nodes, instances: writer.instances };
}
