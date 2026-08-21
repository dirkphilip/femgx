import type {
  AssemblyOccurrenceId,
  GeometryBody,
  PartOccurrenceId,
  PartId,
  Part,
  AssemblyOccurrence,
  SceneOccurrences,
} from "@/entries/root";
import type { BodyId } from "@/entries/model";
import type { WorkbenchModel } from "../models/model";
import { assemblyName } from "./visibility-tree";
import { VisibilityHierarchy } from "./visibility-hierarchy";
import type {
  WorkbenchVisibilityRowSnapshot,
  WorkbenchVisibilitySnapshot,
  VisibilityRowTarget,
} from "./visibility-snapshot";

/** Callbacks that keep the runtime as the single source of visibility truth. */
export interface VisibilityPanelOptions {
  readonly getModel: () => WorkbenchModel;
  readonly getRuntime: () => SceneOccurrences;
  readonly partName: (partId: PartId) => string | undefined;
  readonly partVisible: (partId: PartId) => boolean;
  readonly bodyVisible: (partOccurrenceId: PartOccurrenceId, bodyId: BodyId) => boolean;
  readonly bodyHighlighted: (partOccurrenceId: PartOccurrenceId, bodyId: BodyId) => boolean;
  readonly targetSelected: (target: VisibilityRowTarget) => boolean;
  readonly onChanged: () => void;
}

/** Owns the visibility hierarchy projection while Svelte owns its markup. */
export class VisibilityPanelController {
  private readonly options: VisibilityPanelOptions;
  private current: WorkbenchVisibilitySnapshot = {
    context: "",
    rows: [],
    page: 0,
    pageCount: 0,
    rowCount: 0,
    materializedRowCount: 0,
  };
  private hierarchy: VisibilityHierarchy | undefined;
  private model: WorkbenchModel | undefined;
  private page = 0;
  private readonly partVisibilityKnown = new Uint8Array(64);
  private readonly partVisibilityIds = new Uint32Array(64);
  private readonly partVisibilityValues = new Uint8Array(64);

  constructor(options: VisibilityPanelOptions) {
    this.options = options;
  }

  snapshot(): WorkbenchVisibilitySnapshot {
    return this.current;
  }

  setPage(page: number): void {
    this.page = Math.max(0, Math.floor(page));
    this.sync();
    this.options.onChanged();
  }

  rebuild(): void {
    const runtime = this.options.getRuntime();
    const model = this.options.getModel();
    this.hierarchy = VisibilityHierarchy.build(
      runtime,
      this.model === model ? this.hierarchy : undefined,
    );
    if (this.model !== model) {
      this.model = model;
    }
    this.sync();
  }

  sync(): void {
    const model = this.options.getModel();
    const runtime = this.options.getRuntime();
    const hierarchy = this.hierarchy ?? VisibilityHierarchy.build(runtime);
    this.hierarchy = hierarchy;
    this.partVisibilityKnown.fill(0);
    const rootAssembly = model.scene.assemblies.get(model.scene.rootAssemblyId);
    const rows = new PagedRows(this.page);
    if (hierarchy.count > 0)
      this.appendOccurrence(0, { depth: 1, position: 1, setSize: 1, hidden: false }, rows);
    if (rows.pageCount > 0 && this.page >= rows.pageCount) {
      this.page = rows.pageCount - 1;
      this.sync();
      return;
    }
    this.current = Object.freeze({
      context: `AssemblyDefinition · ${assemblyName(rootAssembly) ?? `AssemblyDefinition ${model.scene.rootAssemblyId}`}`,
      rows: Object.freeze(rows.values),
      page: rows.page,
      pageCount: rows.pageCount,
      rowCount: rows.count,
      materializedRowCount: rows.materializedCount,
    });
  }

  toggleExpanded(occurrenceId: AssemblyOccurrenceId): void {
    const runtime = this.options.getRuntime();
    const ordinal = this.hierarchy?.ordinalOf(runtime, occurrenceId);
    if (ordinal === undefined || !this.isExpandable(ordinal, runtime)) return;
    this.hierarchy?.toggleExpanded(ordinal);
    this.sync();
    this.options.onChanged();
  }

  private appendOccurrence(ordinal: number, layout: RowLayout, rows: PagedRows): void {
    const runtime = this.options.getRuntime();
    const hierarchy = this.hierarchy;
    const occurrenceId = hierarchy?.idAt(runtime, ordinal);
    const occurrence =
      occurrenceId === undefined ? undefined : runtime.getAssemblyOccurrence(occurrenceId);
    if (occurrence === undefined || occurrenceId === undefined || hierarchy === undefined) return;
    const model = this.options.getModel();
    const assembly = model.scene.assemblies.get(occurrence.assemblyId);
    const name = assemblyName(assembly) ?? `AssemblyDefinition ${occurrence.assemblyId}`;
    const displayName = this.assemblyDisplayName(ordinal, name, hierarchy);
    const directCount = occurrence.partOccurrenceCount;
    const childCount = directCount + hierarchy.childCount(ordinal);
    const expanded = hierarchy.isExpanded(ordinal);
    rows.push(() =>
      row({
        key: `assembly:${occurrenceId}`,
        target: { kind: "assemblyOccurrence", assemblyOccurrenceId: occurrenceId },
        kind: "assembly",
        depth: layout.depth,
        label: displayName,
        badge: "AssemblyDefinition",
        testId: `assembly-occurrence-vis-${ordinal}`,
        checked: occurrence.effectiveVisible,
        disabled: this.parentHidden(occurrence.parentAssemblyOccurrenceId, runtime),
        expanded,
        expandable: childCount > 0,
        highlighted: false,
        selected: this.options.targetSelected({
          kind: "assemblyOccurrence",
          assemblyOccurrenceId: occurrenceId,
        }),
        hidden: layout.hidden,
        position: layout.position,
        setSize: layout.setSize,
      }),
    );
    this.appendOccurrenceChildren({
      ordinal,
      occurrenceId,
      occurrence,
      displayName,
      directCount,
      childCount,
      layout: { ...layout, hidden: layout.hidden || !expanded },
      rows,
    });
  }

  private appendOccurrenceChildren(input: OccurrenceChildrenInput): void {
    const {
      ordinal,
      occurrenceId,
      occurrence,
      displayName,
      directCount,
      childCount,
      layout,
      rows,
    } = input;
    for (let index = 0; index < directCount; index += 1) {
      const partOccurrenceId = occurrence.getPartOccurrenceId(index);
      if (partOccurrenceId !== undefined) {
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
    let childPosition = directCount + 1;
    for (const child of this.hierarchy?.children(ordinal) ?? []) {
      this.appendOccurrence(
        child,
        {
          depth: layout.depth + 1,
          position: childPosition,
          setSize: childCount,
          hidden: layout.hidden,
        },
        rows,
      );
      childPosition += 1;
    }
  }

  private appendInstance(
    partOccurrenceId: PartOccurrenceId,
    occurrenceId: AssemblyOccurrenceId,
    assemblyNameValue: string,
    layout: RowLayout,
    rows: PagedRows,
  ): void {
    const runtime = this.options.getRuntime();
    const partId = runtime.getPartId(partOccurrenceId);
    if (partId === undefined) return;
    const partName = this.options.partName(partId) ?? `Part ${partId}`;
    const part = this.options.getModel().scene.parts.get(partId);
    const displayName = this.isRepeatedPart(occurrenceId, partId, runtime)
      ? `${partName} ${layout.position}`
      : partName;
    const bodies = part?.bodies;
    rows.push(() =>
      row({
        key: `instance:${partOccurrenceId}`,
        target: { kind: "partOccurrence", partOccurrenceId },
        kind: "partOccurrence",
        depth: layout.depth,
        label: displayName,
        badge: "Part",
        testId: `instance-vis-${partOccurrenceId}`,
        checked: runtime.isPartOccurrenceVisible(partOccurrenceId),
        disabled: !this.occurrenceVisible(occurrenceId, runtime) || !this.partVisible(partId),
        expanded: (bodies?.count ?? 0) > 0,
        expandable: (bodies?.count ?? 0) > 0,
        highlighted: false,
        selected: this.options.targetSelected({ kind: "partOccurrence", partOccurrenceId }),
        hidden: layout.hidden,
        position: layout.position,
        setSize: layout.setSize,
      }),
    );
    for (let index = 0; index < (bodies?.count ?? 0); index += 1) {
      const body = bodies?.at(index);
      if (body !== undefined) {
        this.appendBody(
          {
            partOccurrenceId,
            body,
            part,
            partName: displayName,
            assemblyName: assemblyNameValue,
            layout: {
              depth: layout.depth + 1,
              position: index + 1,
              setSize: bodies?.count ?? 0,
              hidden: layout.hidden,
            },
          },
          rows,
        );
      }
    }
  }

  private appendBody(input: BodyRowInput, rows: PagedRows): void {
    const { partOccurrenceId, body, partName, assemblyName, layout } = input;
    const bodyName = body.name ?? `Body ${body.id}`;
    rows.push(() =>
      row({
        key: `body:${partOccurrenceId}:${body.id}`,
        target: { kind: "body", partOccurrenceId, bodyId: body.id },
        kind: "body",
        depth: layout.depth,
        label: bodyName,
        badge: "Body",
        ariaLabel: `${bodyName} in ${partName} · ${assemblyName}`,
        testId: `body-vis-${partOccurrenceId}-${body.id}`,
        checked: this.options.bodyVisible(partOccurrenceId, body.id),
        disabled: !this.instanceVisible(this.options.getRuntime(), partOccurrenceId),
        expanded: false,
        expandable: false,
        highlighted: this.options.bodyHighlighted(partOccurrenceId, body.id),
        selected: this.options.targetSelected({ kind: "body", partOccurrenceId, bodyId: body.id }),
        elementCount: this.elementCount(input.part, body.id),
        hidden: layout.hidden,
        position: layout.position,
        setSize: layout.setSize,
      }),
    );
  }

  private elementCount(part: Part | undefined, bodyId: BodyId): number {
    if (part?.elements === undefined) return 0;
    return part.bodies?.get(bodyId)?.elementIds.length ?? 0;
  }

  private isRepeatedPart(
    occurrenceId: AssemblyOccurrenceId,
    partId: PartId,
    runtime: SceneOccurrences,
  ): boolean {
    const occurrence = runtime.getAssemblyOccurrence(occurrenceId);
    if (occurrence === undefined) return false;
    let matches = 0;
    for (let ordinal = 0; ordinal < occurrence.partOccurrenceCount; ordinal += 1) {
      const id = occurrence.getPartOccurrenceId(ordinal);
      if (id !== undefined && runtime.getPartId(id) === partId) matches += 1;
      if (matches > 1) return true;
    }
    return false;
  }

  private occurrenceVisible(
    occurrenceId: AssemblyOccurrenceId,
    runtime: SceneOccurrences,
  ): boolean {
    return runtime.getAssemblyOccurrence(occurrenceId)?.effectiveVisible ?? false;
  }

  private parentHidden(
    parentId: AssemblyOccurrenceId | undefined,
    runtime: SceneOccurrences,
  ): boolean {
    return parentId !== undefined && !this.occurrenceVisible(parentId, runtime);
  }

  private instanceVisible(runtime: SceneOccurrences, partOccurrenceId: PartOccurrenceId): boolean {
    return runtime.isPartOccurrenceVisible(partOccurrenceId);
  }

  private isExpandable(ordinal: number, runtime: SceneOccurrences): boolean {
    const id = this.hierarchy?.idAt(runtime, ordinal);
    const occurrence = id === undefined ? undefined : runtime.getAssemblyOccurrence(id);
    return (
      occurrence !== undefined && (occurrence.partOccurrenceCount > 0 || occurrence.childCount > 0)
    );
  }

  private assemblyDisplayName(
    ordinal: number,
    name: string,
    hierarchy: VisibilityHierarchy,
  ): string {
    const parent = hierarchy.parents[ordinal] ?? -1;
    if (parent === -1) return name;
    const count = hierarchy.siblingDefinitionCounts[ordinal] ?? 0;
    const position = hierarchy.siblingDefinitionPositions[ordinal] ?? 0;
    return count > 1 ? `${name} ${position}` : name;
  }

  private partVisible(partId: PartId): boolean {
    const slot = partId % this.partVisibilityIds.length;
    if (this.partVisibilityKnown[slot] === 1 && this.partVisibilityIds[slot] === partId) {
      return this.partVisibilityValues[slot] === 1;
    }
    const visible = this.options.partVisible(partId);
    this.partVisibilityKnown[slot] = 1;
    this.partVisibilityIds[slot] = partId;
    this.partVisibilityValues[slot] = visible ? 1 : 0;
    return visible;
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
  readonly ordinal: number;
  readonly occurrenceId: AssemblyOccurrenceId;
  readonly occurrence: AssemblyOccurrence;
  readonly displayName: string;
  readonly directCount: number;
  readonly childCount: number;
  readonly layout: RowLayout;
  readonly rows: PagedRows;
}

interface BodyRowInput {
  readonly partOccurrenceId: PartOccurrenceId;
  readonly part: Part | undefined;
  readonly body: GeometryBody;
  readonly partName: string;
  readonly assemblyName: string;
  readonly layout: RowLayout;
}

/** Keeps the current page bounded while counting every logical hierarchy row. */
class PagedRows {
  readonly values: WorkbenchVisibilityRowSnapshot[] = [];
  count = 0;
  materializedCount = 0;
  readonly page: number;

  constructor(page: number) {
    this.page = page;
  }

  get pageCount(): number {
    return Math.ceil(this.count / 1_000);
  }

  push(create: () => WorkbenchVisibilityRowSnapshot): number {
    const offset = this.count - this.page * 1_000;
    this.count += 1;
    if (offset >= 0 && offset < 1_000) {
      this.values.push(create());
      this.materializedCount += 1;
    }
    return this.values.length;
  }
}
