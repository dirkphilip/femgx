import type {
  AssemblyOccurrenceId,
  GeometryBody,
  PartOccurrenceId,
  PartId,
  Part,
} from "../../../src/entries/root";
import type { BodyId } from "../../../src/entries/model";
import type { RuntimeAssemblyOccurrence, SceneRuntime } from "../../../src/entries/runtime";
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
  private occurrenceIds: readonly AssemblyOccurrenceId[] = [];
  private occurrences = new Map<AssemblyOccurrenceId, RuntimeAssemblyOccurrence>();
  private occurrenceDisplayIds = new Map<AssemblyOccurrenceId, number>();
  private instanceDisplayIds = new Map<PartOccurrenceId, number>();
  private occurrenceNames = new Map<AssemblyOccurrenceId, string>();
  private partVisibility = new Map<PartId, boolean>();
  private bodyElementCounts = new Map<PartId, ReadonlyMap<BodyId, number>>();
  private repeatedPartIds = new Set<PartId>();
  private expansionContext:
    | { readonly model: WorkbenchModel; readonly occurrenceIds: readonly AssemblyOccurrenceId[] }
    | undefined;

  constructor(options: VisibilityPanelOptions) {
    this.options = options;
  }

  snapshot(): WorkbenchVisibilitySnapshot {
    return this.current;
  }

  rebuild(): void {
    const runtime = this.options.getRuntime();
    const occurrenceIds = runtime.getOccurrenceIds();
    const model = this.options.getModel();
    const priorContext = this.expansionContext;
    const occurrenceKey = occurrenceIds.join("\0");
    const sameContext =
      priorContext?.model === model && priorContext.occurrenceIds.join("\0") === occurrenceKey;
    this.expanded = sameContext
      ? new Set([...this.expanded].filter((occurrenceId) => occurrenceIds.includes(occurrenceId)))
      : initiallyExpanded(runtime, occurrenceIds);
    this.expansionContext = { model, occurrenceIds: [...occurrenceIds] };
    this.sync();
  }

  sync(): void {
    const model = this.options.getModel();
    const runtime = this.options.getRuntime();
    this.prepareSync(runtime, model);
    const rootAssembly = model.scene.assemblies.get(model.scene.rootAssemblyId);
    const rootOccurrenceId = this.occurrenceIds[0];
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
    const occurrence = this.occurrences.get(occurrenceId);
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
    const occurrence = this.occurrences.get(occurrenceId);
    if (occurrence === undefined) return;
    const model = this.options.getModel();
    const assembly = model.scene.assemblies.get(occurrence.assemblyId);
    const name = assemblyName(assembly) ?? `AssemblyDefinition ${occurrence.assemblyId}`;
    const displayName = this.occurrenceNames.get(occurrenceId) ?? name;
    const directInstances = occurrence.partOccurrenceIds;
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
      occurrenceId,
      childIds: occurrence.childIds,
      directInstances,
      displayName,
      childCount,
      layout: { ...layout, hidden: layout.hidden || !expanded },
      rows,
    });
  }

  private appendOccurrenceChildren(input: OccurrenceChildrenInput): void {
    const { occurrenceId, childIds, directInstances, displayName, childCount, layout, rows } =
      input;
    this.repeatedPartIds = this.repeatedParts(directInstances);
    for (let index = 0; index < directInstances.length; index += 1) {
      const partOccurrenceId = directInstances[index];
      const partId =
        partOccurrenceId === undefined
          ? undefined
          : this.options.getRuntime().getPartId(partOccurrenceId);
      if (partOccurrenceId !== undefined && partId !== undefined) {
        this.appendInstance(
          partOccurrenceId,
          occurrenceId,
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
    occurrenceId: AssemblyOccurrenceId,
    assemblyNameValue: string,
    layout: RowLayout,
    rows: WorkbenchVisibilityRowSnapshot[],
  ): void {
    const runtime = this.options.getRuntime();
    const partId = runtime.getPartId(partOccurrenceId);
    if (partId === undefined) return;
    const partName = this.options.partName(partId) ?? `Part ${partId}`;
    const part = this.options.getModel().scene.parts.get(partId);
    const displayName = this.repeatedPartIds.has(partId)
      ? `${partName} ${layout.position}`
      : partName;
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
        checked: runtime.isPartOccurrenceVisible(partOccurrenceId),
        disabled: !this.occurrenceVisible(occurrenceId) || !this.partVisible(partId),
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
            part,
            partName: displayName,
            partId,
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
    const { partOccurrenceId, body, partId, partName, assemblyName, layout } = input;
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
        elementCount: this.elementCount(partId, input.part, body.id),
        hidden: layout.hidden,
        position: layout.position,
        setSize: layout.setSize,
      }),
    );
  }

  private elementCount(partId: PartId, part: Part | undefined, bodyId: BodyId): number {
    if (part?.elements === undefined) return 0;
    let counts = this.bodyElementCounts.get(partId);
    if (counts === undefined) {
      counts = new Map(
        (part.bodies ?? []).map((body) => [body.id, body.elementIds.length] as const),
      );
      this.bodyElementCounts.set(partId, counts);
    }
    return counts.get(bodyId) ?? 0;
  }

  private repeatedParts(partOccurrenceIds: readonly PartOccurrenceId[]): Set<PartId> {
    const counts = new Map<PartId, number>();
    const runtime = this.options.getRuntime();
    for (const partOccurrenceId of partOccurrenceIds) {
      const partId = runtime.getPartId(partOccurrenceId);
      if (partId !== undefined) counts.set(partId, (counts.get(partId) ?? 0) + 1);
    }
    const repeated = new Set<PartId>();
    for (const [partId, count] of counts) {
      if (count > 1) repeated.add(partId);
    }
    return repeated;
  }

  private occurrenceVisible(occurrenceId: AssemblyOccurrenceId): boolean {
    return this.occurrences.get(occurrenceId)?.effectiveVisible ?? false;
  }

  private parentHidden(parentId: AssemblyOccurrenceId | undefined): boolean {
    return parentId !== undefined && !this.occurrenceVisible(parentId);
  }

  private instanceVisible(runtime: SceneRuntime, partOccurrenceId: PartOccurrenceId): boolean {
    return runtime.isPartOccurrenceVisible(partOccurrenceId);
  }

  private isExpandable(occurrenceId: AssemblyOccurrenceId): boolean {
    const occurrence = this.occurrences.get(occurrenceId);
    return (
      occurrence !== undefined &&
      (occurrence.partOccurrenceIds.length > 0 || occurrence.childIds.length > 0)
    );
  }

  private occurrenceDisplayId(occurrenceId: AssemblyOccurrenceId): number {
    return this.occurrenceDisplayIds.get(occurrenceId) ?? -1;
  }

  private instanceDisplayId(partOccurrenceId: PartOccurrenceId): number {
    return this.instanceDisplayIds.get(partOccurrenceId) ?? -1;
  }

  private partVisible(partId: PartId): boolean {
    if (!this.partVisibility.has(partId)) {
      this.partVisibility.set(partId, this.options.partVisible(partId));
    }
    return this.partVisibility.get(partId) ?? false;
  }

  private prepareSync(runtime: SceneRuntime, model: WorkbenchModel): void {
    const occurrenceIds = runtime.getOccurrenceIds();
    const occurrences = runtime.getOccurrences();
    this.occurrenceIds = occurrenceIds;
    this.occurrences = new Map(
      occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]),
    );
    this.occurrenceDisplayIds = indexMap(occurrenceIds);
    this.instanceDisplayIds = indexMap(runtime.getPartOccurrenceIds());
    this.occurrenceNames = occurrenceDisplayNames(model, occurrences, this.occurrences);
    this.partVisibility = new Map();
    this.bodyElementCounts = new Map();
  }
}

function initiallyExpanded(
  runtime: SceneRuntime,
  occurrenceIds: readonly AssemblyOccurrenceId[],
): Set<AssemblyOccurrenceId> {
  const rootOccurrenceId = occurrenceIds[0];
  return new Set(
    rootOccurrenceId === undefined
      ? []
      : occurrenceIds.filter((occurrenceId) => {
          const occurrence = runtime.getOccurrence(occurrenceId);
          return occurrence?.parentId === undefined || occurrence.parentId === rootOccurrenceId;
        }),
  );
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
  readonly occurrenceId: AssemblyOccurrenceId;
  readonly childIds: readonly AssemblyOccurrenceId[];
  readonly directInstances: readonly PartOccurrenceId[];
  readonly displayName: string;
  readonly childCount: number;
  readonly layout: RowLayout;
  readonly rows: WorkbenchVisibilityRowSnapshot[];
}

interface BodyRowInput {
  readonly partOccurrenceId: PartOccurrenceId;
  readonly partId: PartId;
  readonly part: Part | undefined;
  readonly body: GeometryBody;
  readonly partName: string;
  readonly assemblyName: string;
  readonly layout: RowLayout;
}

function indexMap<T>(ids: readonly T[]): Map<T, number> {
  return new Map(ids.map((id, index) => [id, index] as const));
}

function occurrenceDisplayNames(
  model: WorkbenchModel,
  occurrences: readonly RuntimeAssemblyOccurrence[],
  byId: ReadonlyMap<AssemblyOccurrenceId, RuntimeAssemblyOccurrence>,
): Map<AssemblyOccurrenceId, string> {
  const names = new Map<AssemblyOccurrenceId, string>();
  for (const occurrence of occurrences) {
    names.set(occurrence.occurrenceId, assemblyDisplayName(model, occurrence.assemblyId));
  }
  for (const parent of occurrences) {
    const counts = new Map<number, number>();
    for (const childId of parent.childIds) {
      const child = byId.get(childId);
      if (child !== undefined)
        counts.set(child.assemblyId, (counts.get(child.assemblyId) ?? 0) + 1);
    }
    const positions = new Map<number, number>();
    for (const childId of parent.childIds) {
      const child = byId.get(childId);
      if (child === undefined) continue;
      const position = (positions.get(child.assemblyId) ?? 0) + 1;
      positions.set(child.assemblyId, position);
      if ((counts.get(child.assemblyId) ?? 0) > 1) {
        names.set(childId, `${names.get(childId) ?? "AssemblyDefinition"} ${position}`);
      }
    }
  }
  return names;
}

function assemblyDisplayName(model: WorkbenchModel, assemblyId: number): string {
  return assemblyName(model.scene.assemblies.get(assemblyId)) ?? `AssemblyDefinition ${assemblyId}`;
}
