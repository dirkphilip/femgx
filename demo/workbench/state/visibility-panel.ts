import type {
  AssemblyOccurrenceId,
  GeometryBody,
  PartOccurrenceId,
  PartId,
} from "../../../src/entries/root";
import type { BodyId } from "../../../src/entries/model";
import type { SceneRuntime } from "../../../src/entries/runtime";
import type { WorkbenchModel } from "../models/model";
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
  readonly bodyVisible: (partOccurrenceId: PartOccurrenceId, bodyId: BodyId) => boolean;
  readonly bodyHighlighted: (partOccurrenceId: PartOccurrenceId, bodyId: BodyId) => boolean;
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
      context: `AssemblyDefinition · ${assemblyName(rootAssembly) ?? `AssemblyDefinition ${model.scene.rootAssemblyId}`}`,
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
    const name = assemblyName(assembly) ?? `AssemblyDefinition ${occurrence.assemblyId}`;
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
        badge: "AssemblyDefinition",
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
      const partOccurrenceId = directInstances[index];
      if (partOccurrenceId !== undefined) {
        this.appendInstance(
          partOccurrenceId,
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
    partOccurrenceId: PartOccurrenceId,
    assemblyNameValue: string,
    layout: RowLayout,
    rows: WorkbenchVisibilityRowSnapshot[],
  ): void {
    const runtime = this.options.getRuntime();
    const instance = runtime.getPartOccurrence(partOccurrenceId);
    if (instance === undefined) return;
    const partName = this.options.partName(instance.partId) ?? `Part ${instance.partId}`;
    const part = this.options.getModel().scene.parts.get(instance.partId);
    const siblings = this.directPartInstances(instance.occurrenceId);
    const repeated =
      siblings.filter((item) => runtime.getPartId(item) === instance.partId).length > 1;
    const displayName = repeated ? `${partName} ${layout.position}` : partName;
    const bodies = part?.bodies ?? [];
    rows.push(
      row({
        key: `instance:${partOccurrenceId}`,
        target: { kind: "partOccurrence", partOccurrenceId },
        kind: "partOccurrence",
        depth: layout.depth,
        label: displayName,
        badge: "Part",
        testId: `instance-vis-${this.instanceDisplayId(partOccurrenceId)}`,
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
            partOccurrenceId,
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
    const { partOccurrenceId, body, partName, assemblyName, layout } = input;
    const bodyName = body.name ?? `Body ${body.id}`;
    rows.push(
      row({
        key: `body:${partOccurrenceId}:${body.id}`,
        target: { kind: "body", partOccurrenceId, bodyId: body.id },
        kind: "body",
        depth: layout.depth,
        label: bodyName,
        badge: "Body",
        ariaLabel: `${bodyName} in ${partName} · ${assemblyName}`,
        testId: `body-vis-${this.instanceDisplayId(partOccurrenceId)}-${body.id}`,
        checked: this.options.bodyVisible(partOccurrenceId, body.id),
        disabled: !this.instanceVisible(this.options.getRuntime(), partOccurrenceId),
        expanded: false,
        expandable: false,
        highlighted: this.options.bodyHighlighted(partOccurrenceId, body.id),
        elementCount: this.elementCount(partOccurrenceId, body.id),
        hidden: layout.hidden,
        position: layout.position,
        setSize: layout.setSize,
      }),
    );
  }

  private elementCount(partOccurrenceId: PartOccurrenceId, bodyId: BodyId): number {
    const instance = this.options.getRuntime().getPartOccurrence(partOccurrenceId);
    const part =
      instance === undefined ? undefined : this.options.getModel().scene.parts.get(instance.partId);
    if (part?.elements === undefined) return 0;
    return part.bodies?.find((body) => body.id === bodyId)?.elementIds.length ?? 0;
  }

  private directPartInstances(occurrenceId: AssemblyOccurrenceId): PartOccurrenceId[] {
    return [...(this.options.getRuntime().getOccurrence(occurrenceId)?.partOccurrenceIds ?? [])];
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

  private instanceVisible(runtime: SceneRuntime, partOccurrenceId: PartOccurrenceId): boolean {
    return runtime.isPartOccurrenceVisible(partOccurrenceId);
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

  private instanceDisplayId(partOccurrenceId: PartOccurrenceId): number {
    return this.options.getRuntime().getPartOccurrenceIds().indexOf(partOccurrenceId);
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
  readonly directInstances: readonly PartOccurrenceId[];
  readonly displayName: string;
  readonly childCount: number;
  readonly layout: RowLayout;
  readonly rows: WorkbenchVisibilityRowSnapshot[];
}

interface BodyRowInput {
  readonly partOccurrenceId: PartOccurrenceId;
  readonly body: GeometryBody;
  readonly partName: string;
  readonly assemblyName: string;
  readonly layout: RowLayout;
}
