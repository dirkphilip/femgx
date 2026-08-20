import type { AssemblyOccurrenceId, SceneOccurrences } from "../../../src/entries/root";

/** Dense, renderer-independent hierarchy adjacency for one rebuilt visibility tree. */
export class VisibilityHierarchy {
  private constructor(private readonly storage: HierarchyStorage) {}

  get assemblyDefinitionIds(): Uint32Array {
    return this.storage.assemblyDefinitionIds;
  }

  get parents(): Int32Array {
    return this.storage.parents;
  }

  get firstChildren(): Int32Array {
    return this.storage.firstChildren;
  }

  get nextSiblings(): Int32Array {
    return this.storage.nextSiblings;
  }

  get siblingDefinitionCounts(): Uint32Array {
    return this.storage.siblingDefinitionCounts;
  }

  get siblingDefinitionPositions(): Uint32Array {
    return this.storage.siblingDefinitionPositions;
  }

  get expanded(): Uint8Array {
    return this.storage.expanded;
  }

  get collapsed(): Uint8Array {
    return this.storage.collapsed;
  }

  get occurrenceOffsets(): Uint32Array {
    return this.storage.occurrenceOffsets;
  }

  get occurrenceText(): Uint16Array {
    return this.storage.occurrenceText;
  }

  get count(): number {
    return this.assemblyDefinitionIds.length;
  }

  idAt(runtime: SceneOccurrences, ordinal: number): AssemblyOccurrenceId | undefined {
    return runtime.getAssemblyOccurrenceId(ordinal);
  }

  ordinalOf(_runtime: SceneOccurrences, id: AssemblyOccurrenceId): number | undefined {
    return this.ordinalOfText(id);
  }

  isExpanded(ordinal: number): boolean {
    if (this.expanded[ordinal] === 1) return true;
    if (this.collapsed[ordinal] === 1) return false;
    return ordinal === 0 || this.parents[ordinal] === 0;
  }

  toggleExpanded(ordinal: number): void {
    if (this.isExpanded(ordinal)) {
      this.expanded[ordinal] = 0;
      this.collapsed[ordinal] = 1;
    } else {
      this.collapsed[ordinal] = 0;
      this.expanded[ordinal] = 1;
    }
  }

  childCount(ordinal: number): number {
    let count = 0;
    for (const child of this.children(ordinal)) {
      void child;
      count += 1;
    }
    return count;
  }

  *children(ordinal: number): IterableIterator<number> {
    for (
      let child = this.firstChildren[ordinal] ?? -1;
      child !== -1;
      child = this.nextSiblings[child] ?? -1
    ) {
      yield child;
    }
  }

  static build(runtime: SceneOccurrences, prior?: VisibilityHierarchy): VisibilityHierarchy {
    const columns = allocateColumns(runtime);
    populateColumns(runtime, columns);
    populateSiblingDefinitionPositions(columns);
    const hierarchy = new VisibilityHierarchy({
      assemblyDefinitionIds: columns.assemblyDefinitionIds,
      occurrenceOffsets: columns.occurrenceOffsets,
      occurrenceText: columns.occurrenceText,
      occurrenceHashes: columns.occurrenceHashes,
      indexHeads: columns.indexHeads,
      indexNext: columns.indexNext,
      parents: columns.parents,
      firstChildren: columns.firstChildren,
      nextSiblings: columns.nextSiblings,
      siblingDefinitionCounts: columns.siblingDefinitionCounts,
      siblingDefinitionPositions: columns.siblingDefinitionPositions,
      expanded: new Uint8Array(columns.assemblyDefinitionIds.length),
      collapsed: new Uint8Array(columns.assemblyDefinitionIds.length),
    });
    hierarchy.copyExpansionState(prior);
    return hierarchy;
  }

  private ordinalOfText(id: string): number | undefined {
    return this.findOrdinal(hashOccurrenceId(id), (ordinal) => this.matchesText(ordinal, id));
  }

  private findOrdinal(hash: number, matches: (ordinal: number) => boolean): number | undefined {
    for (
      let ordinal = this.storage.indexHeads[hash & (this.storage.indexHeads.length - 1)] ?? -1;
      ordinal !== -1;
      ordinal = this.storage.indexNext[ordinal] ?? -1
    ) {
      if (this.storage.occurrenceHashes[ordinal] === hash && matches(ordinal)) return ordinal;
    }
    return undefined;
  }

  private matchesText(ordinal: number, id: string): boolean {
    const start = this.occurrenceOffsets[ordinal] ?? 0;
    const end = this.occurrenceOffsets[ordinal + 1] ?? start;
    if (end - start !== id.length) return false;
    for (let index = 0; index < id.length; index += 1) {
      if (this.occurrenceText[start + index] !== id.charCodeAt(index)) return false;
    }
    return true;
  }

  private matchesPacked(
    ordinal: number,
    other: VisibilityHierarchy,
    otherOrdinal: number,
  ): boolean {
    const start = this.occurrenceOffsets[ordinal] ?? 0;
    const end = this.occurrenceOffsets[ordinal + 1] ?? start;
    const otherStart = other.occurrenceOffsets[otherOrdinal] ?? 0;
    const otherEnd = other.occurrenceOffsets[otherOrdinal + 1] ?? otherStart;
    if (end - start !== otherEnd - otherStart) return false;
    for (let index = 0; index < end - start; index += 1) {
      if (this.occurrenceText[start + index] !== other.occurrenceText[otherStart + index])
        return false;
    }
    return true;
  }

  private copyExpansionState(prior: VisibilityHierarchy | undefined): void {
    if (prior === undefined) return;
    for (let ordinal = 0; ordinal < this.count; ordinal += 1) {
      const hash = this.storage.occurrenceHashes[ordinal] ?? 0;
      const previous = prior.findOrdinal(hash, (candidate) =>
        this.matchesPacked(ordinal, prior, candidate),
      );
      if (previous === undefined) continue;
      this.expanded[ordinal] = prior.expanded[previous] ?? 0;
      this.collapsed[ordinal] = prior.collapsed[previous] ?? 0;
    }
  }
}

interface HierarchyStorage {
  readonly assemblyDefinitionIds: Uint32Array;
  readonly occurrenceOffsets: Uint32Array;
  readonly occurrenceText: Uint16Array;
  readonly occurrenceHashes: Uint32Array;
  readonly indexHeads: Int32Array;
  readonly indexNext: Int32Array;
  readonly parents: Int32Array;
  readonly firstChildren: Int32Array;
  readonly nextSiblings: Int32Array;
  readonly siblingDefinitionCounts: Uint32Array;
  readonly siblingDefinitionPositions: Uint32Array;
  readonly expanded: Uint8Array;
  readonly collapsed: Uint8Array;
}

interface HierarchyColumns {
  readonly assemblyDefinitionIds: Uint32Array;
  readonly occurrenceOffsets: Uint32Array;
  readonly occurrenceText: Uint16Array;
  readonly occurrenceHashes: Uint32Array;
  readonly indexHeads: Int32Array;
  readonly indexNext: Int32Array;
  readonly parents: Int32Array;
  readonly firstChildren: Int32Array;
  readonly nextSiblings: Int32Array;
  readonly siblingDefinitionCounts: Uint32Array;
  readonly siblingDefinitionPositions: Uint32Array;
  readonly lastChildren: Int32Array;
  readonly ancestors: Int32Array;
}

function allocateColumns(runtime: SceneOccurrences): HierarchyColumns {
  let textLength = 0;
  for (let ordinal = 0; ordinal < runtime.assemblyOccurrenceCount; ordinal += 1) {
    const id = runtime.getAssemblyOccurrenceId(ordinal);
    if (id === undefined) throw new Error(`Assembly occurrence ${ordinal} is missing`);
    textLength += id.length;
  }
  const count = runtime.assemblyOccurrenceCount;
  return {
    assemblyDefinitionIds: new Uint32Array(count),
    occurrenceOffsets: new Uint32Array(count + 1),
    occurrenceText: new Uint16Array(textLength),
    occurrenceHashes: new Uint32Array(count),
    indexHeads: new Int32Array(indexCapacity(count)).fill(-1),
    indexNext: new Int32Array(count).fill(-1),
    parents: new Int32Array(count).fill(-1),
    firstChildren: new Int32Array(count).fill(-1),
    nextSiblings: new Int32Array(count).fill(-1),
    siblingDefinitionCounts: new Uint32Array(count),
    siblingDefinitionPositions: new Uint32Array(count),
    lastChildren: new Int32Array(count).fill(-1),
    ancestors: new Int32Array(count),
  };
}

function populateColumns(runtime: SceneOccurrences, columns: HierarchyColumns): void {
  let ancestorCount = 0;
  let textOffset = 0;
  for (let ordinal = 0; ordinal < columns.assemblyDefinitionIds.length; ordinal += 1) {
    const id = runtime.getAssemblyOccurrenceId(ordinal);
    const occurrence = id === undefined ? undefined : runtime.getAssemblyOccurrence(id);
    if (occurrence === undefined || id === undefined)
      throw new Error(`Assembly occurrence ${ordinal} is missing`);
    columns.assemblyDefinitionIds[ordinal] = occurrence.assemblyId;
    columns.occurrenceOffsets[ordinal] = textOffset;
    for (let index = 0; index < id.length; index += 1) {
      columns.occurrenceText[textOffset + index] = id.charCodeAt(index);
    }
    textOffset += id.length;
    columns.occurrenceHashes[ordinal] = hashOccurrenceId(id);
    insertIndex(columns, ordinal);
    ancestorCount = trimAncestors(
      runtime,
      columns,
      ancestorCount,
      occurrence.parentAssemblyOccurrenceId,
    );
    const parent =
      occurrence.parentAssemblyOccurrenceId === undefined
        ? -1
        : (columns.ancestors[ancestorCount - 1] ?? -1);
    if (occurrence.parentAssemblyOccurrenceId !== undefined && parent === -1) {
      throw new Error(`Assembly occurrence ${id} has no preceding parent`);
    }
    columns.parents[ordinal] = parent;
    appendChild(columns, parent, ordinal);
    columns.ancestors[ancestorCount] = ordinal;
    ancestorCount += 1;
  }
  columns.occurrenceOffsets[columns.assemblyDefinitionIds.length] = textOffset;
}

function trimAncestors(
  runtime: SceneOccurrences,
  columns: HierarchyColumns,
  count: number,
  parentId: AssemblyOccurrenceId | undefined,
): number {
  let result = count;
  while (
    result > 0 &&
    runtime.getAssemblyOccurrenceId(columns.ancestors[result - 1] ?? -1) !== parentId
  ) {
    result -= 1;
  }
  return result;
}

function insertIndex(columns: HierarchyColumns, ordinal: number): void {
  const hash = columns.occurrenceHashes[ordinal] ?? 0;
  const slot = hash & (columns.indexHeads.length - 1);
  columns.indexNext[ordinal] = columns.indexHeads[slot] ?? -1;
  columns.indexHeads[slot] = ordinal;
}

function appendChild(columns: HierarchyColumns, parent: number, child: number): void {
  if (parent === -1) return;
  const previous = columns.lastChildren[parent] ?? -1;
  if (previous === -1) columns.firstChildren[parent] = child;
  else columns.nextSiblings[previous] = child;
  columns.lastChildren[parent] = child;
}

function populateSiblingDefinitionPositions(columns: HierarchyColumns): void {
  const order = new Uint32Array(columns.assemblyDefinitionIds.length);
  for (let ordinal = 0; ordinal < order.length; ordinal += 1) order[ordinal] = ordinal;
  order.sort((left, right) => compareSiblingDefinition(columns, left, right));
  let start = 0;
  while (start < order.length) {
    let end = start + 1;
    while (
      end < order.length &&
      compareSiblingDefinition(columns, order[start] ?? 0, order[end] ?? 0) === 0
    ) {
      end += 1;
    }
    for (let index = start; index < end; index += 1) {
      const ordinal = order[index] ?? 0;
      columns.siblingDefinitionCounts[ordinal] = end - start;
      columns.siblingDefinitionPositions[ordinal] = index - start + 1;
    }
    start = end;
  }
}

function compareSiblingDefinition(columns: HierarchyColumns, left: number, right: number): number {
  const leftParent = columns.parents[left] ?? -1;
  const rightParent = columns.parents[right] ?? -1;
  if (leftParent !== rightParent) return leftParent - rightParent;
  return (columns.assemblyDefinitionIds[left] ?? 0) - (columns.assemblyDefinitionIds[right] ?? 0);
}

function indexCapacity(count: number): number {
  let capacity = 1;
  while (capacity < Math.ceil(count / 0.7)) capacity *= 2;
  return capacity;
}

function hashOccurrenceId(id: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16_777_619) >>> 0;
  }
  return hash;
}
