/** Updates one value in an immutable set, preserving identity for no-ops. */
export function updateSet<T>(current: ReadonlySet<T>, value: T, enabled: boolean): ReadonlySet<T> {
  if (current.has(value) === enabled) return current;
  const next = new Set(current);
  if (enabled) next.add(value);
  else next.delete(value);
  return next;
}

/** Updates one nested set entry, preserving map identity for no-ops. */
export function updateNestedSet<OuterKey, InnerKey>(
  current: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>,
  outerKey: OuterKey,
  innerKey: InnerKey,
  enabled: boolean,
): ReadonlyMap<OuterKey, ReadonlySet<InnerKey>> {
  const values = current.get(outerKey);
  if (values === undefined && !enabled) return current;
  const nextValues = updateSet(values ?? new Set<InnerKey>(), innerKey, enabled);
  if (nextValues === values) return current;
  const next = new Map(current);
  if (nextValues.size === 0) next.delete(outerKey);
  else next.set(outerKey, nextValues);
  return next;
}

/** Updates one nested map entry, preserving map identity for no-ops. */
export function updateNestedMap<OuterKey, InnerKey, Value>(
  current: ReadonlyMap<OuterKey, ReadonlyMap<InnerKey, Value>>,
  outerKey: OuterKey,
  innerKey: InnerKey,
  value: Value | undefined,
): ReadonlyMap<OuterKey, ReadonlyMap<InnerKey, Value>> {
  const values = current.get(outerKey);
  if (values?.get(innerKey) === value) return current;
  const nextValues = new Map(values ?? []);
  if (value === undefined) nextValues.delete(innerKey);
  else nextValues.set(innerKey, value);
  const next = new Map(current);
  if (nextValues.size === 0) next.delete(outerKey);
  else next.set(outerKey, nextValues);
  return next;
}

/** Updates one flat map entry, preserving map identity for no-ops. */
export function updateMapValue<Key, Value>(
  current: ReadonlyMap<Key, Value>,
  key: Key,
  value: Value | undefined,
): ReadonlyMap<Key, Value> {
  if (current.get(key) === value) return current;
  const next = new Map(current);
  if (value === undefined) next.delete(key);
  else next.set(key, value);
  return next;
}

/** Compares the identity fields of two optional interaction references. */
export function sameRef<T>(
  left: T | undefined,
  right: T | undefined,
  identity: (value: T) => readonly unknown[],
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  const leftIdentity = identity(left);
  const rightIdentity = identity(right);
  return (
    leftIdentity.length === rightIdentity.length &&
    leftIdentity.every((value, index) => value === rightIdentity[index])
  );
}

/** Collects references in caller-defined order without duplicate identities. */
export function collectUniqueRefs<T>(
  hovered: T | undefined,
  keyOf: (value: T) => string,
  append: (push: (value: T) => void) => void,
): readonly T[] {
  const refs: T[] = [];
  const seen = new Set<string>();
  const push = (value: T): void => {
    const key = keyOf(value);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(value);
  };
  if (hovered !== undefined) push(hovered);
  append(push);
  return refs;
}

/** Returns numbers in deterministic ascending order. */
export function sortedNumbers(values: Iterable<number>): number[] {
  return Array.from(values).sort((a, b) => a - b);
}

/** Returns strings in deterministic ascending order. */
export function sortedStrings(values: Iterable<string>): string[] {
  return Array.from(values).sort();
}

/** Applies style layers in order, preserving the base object for no layers. */
export function applyStyleLayers<Style extends object>(
  base: Style,
  layers: readonly (Partial<Style> | undefined)[],
): Style {
  return layers.reduce<Style>(
    (style, layer) => (layer === undefined ? style : { ...style, ...layer }),
    base,
  );
}
