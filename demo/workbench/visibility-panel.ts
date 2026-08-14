import type {
  AssemblyOccurrenceId,
  Body,
  BodyId,
  InstanceId,
  PartId,
  SceneRuntime,
} from "../../src/index";
import type { WorkbenchModel } from "./model";
import { assemblyName } from "./visibility-tree";
import type {
  WorkbenchVisibilityRowSnapshot,
  WorkbenchVisibilitySnapshot,
} from "./visibility-snapshot";

/** Callbacks that keep the runtime as the single source of visibility truth. */
export interface VisibilityPanelOptions {
  readonly getModel: () => WorkbenchModel;
  readonly getRuntime: () => SceneRuntime;
  readonly partName: (partId: PartId) => string | undefined;
  readonly partVisible: (partId: PartId) => boolean;
  readonly bodyVisible: (instanceId: InstanceId, bodyId: BodyId) => boolean;
  readonly bodyHighlighted: (instanceId: InstanceId, bodyId: BodyId) => boolean;
  readonly onChanged: () => void;
}

/** Owns the visibility hierarchy projection while Svelte owns its markup. */
export class VisibilityPanelController {
  private readonly options: VisibilityPanelOptions;
  private expanded = new Set<AssemblyOccurrenceId>();
  private current: WorkbenchVisibilitySnapshot = { context: "", rows: [] };

  constructor(options: VisibilityPanelOptions) {
    this.options = options;
  }

  snapshot(): WorkbenchVisibilitySnapshot {
    return this.current;
  }

  rebuild(): void {
    const runtime = this.options.getRuntime();
    const rootOccurrenceId = runtime.getOccurrenceIds()[0];
    this.expanded = new Set(
      rootOccurrenceId === undefined
        ? []
        : runtime.getOccurrenceIds().filter((occurrenceId) => {
            const occurrence = runtime.getOccurrence(occurrenceId);
            return occurrence?.parentId === undefined || occurrence.parentId === rootOccurrenceId;
          }),
    );
    this.sync();
  }

  sync(): void {
    const model = this.options.getModel();
    const runtime = this.options.getRuntime();
    const rootAssembly = model.scene.assemblies.get(model.scene.rootAssemblyId);
    const rootOccurrenceId = runtime.getOccurrenceIds()[0];
    const rows: WorkbenchVisibilityRowSnapshot[] = [];
    if (rootOccurrenceId !== undefined) {
      this.appendOccurrence(
        rootOccurrenceId,
        { depth: 1, position: 1, setSize: 1, hidden: false },
        rows,
      );
    }
    this.current = Object.freeze({
      context: `Assembly · ${assemblyName(rootAssembly) ?? `Assembly ${model.scene.rootAssemblyId}`}`,
      rows: Object.freeze(rows),
    });
  }

  toggleExpanded(occurrenceId: AssemblyOccurrenceId): void {
    const occurrence = this.options.getRuntime().getOccurrence(occurrenceId);
    if (occurrence === undefined || !this.isExpandable(occurrenceId)) return;
    if (this.expanded.has(occurrenceId)) this.expanded.delete(occurrenceId);
    else this.expanded.add(occurrenceId);
    this.sync();
    this.options.onChanged();
  }

  private appendOccurrence(
    occurrenceId: AssemblyOccurrenceId,
    layout: RowLayout,
    rows: WorkbenchVisibilityRowSnapshot[],
  ): void {
    const runtime = this.options.getRuntime();
    const occurrence = runtime.getOccurrence(occurrenceId);
    if (occurrence === undefined) return;
    const model = this.options.getModel();
    const assembly = model.scene.assemblies.get(occurrence.assemblyId);
    const name = assemblyName(assembly) ?? `Assembly ${occurrence.assemblyId}`;
    const displayName = this.assemblyOccurrenceName(occurrenceId, name);
    const directInstances = this.directPartInstances(occurrenceId);
    const childCount = directInstances.length + occurrence.childIds.length;
    const expanded = this.expanded.has(occurrenceId);
    rows.push(
      row({
        key: `assembly:${occurrenceId}`,
        target: { kind: "assembly", occurrenceId },
        kind: "assembly",
        depth: layout.depth,
        label: displayName,
        badge: "Assembly",
        testId: `assembly-occurrence-vis-${this.occurrenceDisplayId(occurrenceId)}`,
        checked: occurrence.effectiveVisible,
        disabled: this.parentHidden(occurrence.parentId),
        expanded,
        expandable: childCount > 0,
        highlighted: false,
        hidden: layout.hidden,
        position: layout.position,
        setSize: layout.setSize,
      }),
    );
    this.appendOccurrenceChildren({
      childIds: occurrence.childIds,
      directInstances,
      displayName,
      childCount,
      layout: { ...layout, hidden: layout.hidden || !expanded },
      rows,
    });
  }

  private appendOccurrenceChildren(input: OccurrenceChildrenInput): void {
    const { childIds, directInstances, displayName, childCount, layout, rows } = input;
    for (let index = 0; index < directInstances.length; index += 1) {
      const instanceId = directInstances[index];
      if (instanceId !== undefined) {
        this.appendInstance(
          instanceId,
          displayName,
          {
            depth: layout.depth + 1,
            position: index + 1,
            setSize: childCount,
            hidden: layout.hidden,
          },
          rows,
        );
      }
    }
    for (let index = 0; index < childIds.length; index += 1) {
      const childId = childIds[index];
      if (childId !== undefined) {
        this.appendOccurrence(
          childId,
          {
            depth: layout.depth + 1,
            position: directInstances.length + index + 1,
            setSize: childCount,
            hidden: layout.hidden,
          },
          rows,
        );
      }
    }
  }

  private appendInstance(
    instanceId: InstanceId,
    assemblyNameValue: string,
    layout: RowLayout,
    rows: WorkbenchVisibilityRowSnapshot[],
  ): void {
    const runtime = this.options.getRuntime();
    const instance = runtime.getInstance(instanceId);
    if (instance === undefined) return;
    const partName = this.options.partName(instance.partId) ?? `Part ${instance.partId}`;
    const siblings = this.directPartInstances(instance.occurrenceId);
    const repeated =
      siblings.filter((item) => runtime.getPartId(item) === instance.partId).length > 1;
    const displayName = repeated ? `${partName} ${layout.position}` : partName;
    const bodies = this.options.getModel().scene.parts.get(instance.partId)?.geometry.bodies ?? [];
    rows.push(
      row({
        key: `instance:${instanceId}`,
        target: { kind: "instance", instanceId },
        kind: "instance",
        depth: layout.depth,
        label: displayName,
        badge: "Part",
        testId: `instance-vis-${this.instanceDisplayId(instanceId)}`,
        checked: instance.visible,
        disabled:
          !this.occurrenceVisible(instance.occurrenceId) ||
          !this.options.partVisible(instance.partId),
        expanded: bodies.length > 0,
        expandable: bodies.length > 0,
        highlighted: false,
        hidden: layout.hidden,
        position: layout.position,
        setSize: layout.setSize,
      }),
    );
    for (let index = 0; index < bodies.length; index += 1) {
      const body = bodies[index];
      if (body !== undefined) {
        this.appendBody(
          {
            instanceId,
            body,
            partName: displayName,
            assemblyName: assemblyNameValue,
            layout: {
              depth: layout.depth + 1,
              position: index + 1,
              setSize: bodies.length,
              hidden: layout.hidden,
            },
          },
          rows,
        );
      }
    }
  }

  private appendBody(input: BodyRowInput, rows: WorkbenchVisibilityRowSnapshot[]): void {
    const { instanceId, body, partName, assemblyName, layout } = input;
    const bodyName = body.name ?? `Body ${body.id}`;
    rows.push(
      row({
        key: `body:${instanceId}:${body.id}`,
        target: { kind: "body", instanceId, bodyId: body.id },
        kind: "body",
        depth: layout.depth,
        label: bodyName,
        badge: "Body",
        ariaLabel: `${bodyName} in ${partName} · ${assemblyName}`,
        testId: `body-vis-${this.instanceDisplayId(instanceId)}-${body.id}`,
        checked: this.options.bodyVisible(instanceId, body.id),
        disabled: !this.instanceVisible(this.options.getRuntime(), instanceId),
        expanded: false,
        expandable: false,
        highlighted: this.options.bodyHighlighted(instanceId, body.id),
        hidden: layout.hidden,
        position: layout.position,
        setSize: layout.setSize,
      }),
    );
  }

  private directPartInstances(occurrenceId: AssemblyOccurrenceId): InstanceId[] {
    const runtime = this.options.getRuntime();
    return (
      runtime.getOccurrence(occurrenceId)?.instanceIds.filter((instanceId) => {
        return runtime.getInstance(instanceId)?.occurrenceId === occurrenceId;
      }) ?? []
    );
  }

  private assemblyOccurrenceName(occurrenceId: AssemblyOccurrenceId, name: string): string {
    const runtime = this.options.getRuntime();
    const occurrence = runtime.getOccurrence(occurrenceId);
    const parent =
      occurrence?.parentId === undefined ? undefined : runtime.getOccurrence(occurrence.parentId);
    if (parent === undefined || occurrence === undefined) return name;
    let occurrenceNumber = 0;
    let total = 0;
    for (const siblingId of parent.childIds) {
      const sibling = runtime.getOccurrence(siblingId);
      if (sibling?.assemblyId === occurrence.assemblyId) {
        total += 1;
        if (siblingId === occurrenceId) occurrenceNumber = total;
      }
    }
    return total > 1 ? `${name} ${occurrenceNumber}` : name;
  }

  private occurrenceVisible(occurrenceId: AssemblyOccurrenceId): boolean {
    return this.options.getRuntime().getOccurrence(occurrenceId)?.effectiveVisible ?? false;
  }

  private parentHidden(parentId: AssemblyOccurrenceId | undefined): boolean {
    return parentId !== undefined && !this.occurrenceVisible(parentId);
  }

  private instanceVisible(runtime: SceneRuntime, instanceId: InstanceId): boolean {
    return runtime.isInstanceVisible(instanceId);
  }

  private isExpandable(occurrenceId: AssemblyOccurrenceId): boolean {
    const occurrence = this.options.getRuntime().getOccurrence(occurrenceId);
    return (
      occurrence !== undefined &&
      (this.directPartInstances(occurrenceId).length > 0 || occurrence.childIds.length > 0)
    );
  }

  private occurrenceDisplayId(occurrenceId: AssemblyOccurrenceId): number {
    return this.options.getRuntime().getOccurrenceIds().indexOf(occurrenceId);
  }

  private instanceDisplayId(instanceId: InstanceId): number {
    return this.options.getRuntime().getInstanceIds().indexOf(instanceId);
  }
}

function row(
  input: Omit<WorkbenchVisibilityRowSnapshot, "ariaLabel"> & {
    readonly ariaLabel?: string;
  },
): WorkbenchVisibilityRowSnapshot {
  return Object.freeze({ ...input, ariaLabel: input.ariaLabel });
}

interface RowLayout {
  readonly depth: number;
  readonly hidden: boolean;
  readonly position: number;
  readonly setSize: number;
}

interface OccurrenceChildrenInput {
  readonly childIds: readonly AssemblyOccurrenceId[];
  readonly directInstances: readonly InstanceId[];
  readonly displayName: string;
  readonly childCount: number;
  readonly layout: RowLayout;
  readonly rows: WorkbenchVisibilityRowSnapshot[];
}

interface BodyRowInput {
  readonly instanceId: InstanceId;
  readonly body: Body;
  readonly partName: string;
  readonly assemblyName: string;
  readonly layout: RowLayout;
}
