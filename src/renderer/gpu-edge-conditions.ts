type EdgeCondition = readonly [number, number, number, number, number, number];

/** Appends deterministically ordered owner metadata for one logical edge. */
export function appendEdgeConditions(options: {
  readonly encoded: ReadonlySet<string>;
  readonly edgeIndex: number;
  readonly blockAware: boolean;
  readonly bodyRanges: Uint32Array;
  readonly bodyIds: number[];
  readonly elementIds: number[];
  readonly blockIds: number[];
}): void {
  const conditions = [...options.encoded].map(parseEdgeCondition).sort(compareEdgeConditions);
  options.bodyRanges[options.edgeIndex * 2] = options.bodyIds.length / 2;
  options.bodyRanges[options.edgeIndex * 2 + 1] = conditions.length;
  for (const [owner, neighbor, element, neighborElement, block, neighborBlock] of conditions) {
    options.bodyIds.push(owner, neighbor);
    options.elementIds.push(element, neighborElement);
    if (options.blockAware) options.blockIds.push(block, neighborBlock);
  }
}

function parseEdgeCondition(value: string): EdgeCondition {
  const numbers = value.split(",").map(Number);
  return [
    numbers[0] ?? 0,
    numbers[1] ?? 0,
    numbers[2] ?? 0,
    numbers[3] ?? 0,
    numbers[4] ?? 0,
    numbers[5] ?? 0,
  ];
}

function compareEdgeConditions(left: EdgeCondition, right: EdgeCondition): number {
  return (
    left[0] - right[0] ||
    left[1] - right[1] ||
    left[2] - right[2] ||
    left[3] - right[3] ||
    left[4] - right[4] ||
    left[5] - right[5]
  );
}
