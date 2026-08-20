/** Updates one value in an immutable set, preserving identity for no-ops. */
export function updateSet<T>(current: ReadonlySet<T>, value: T, enabled: boolean): ReadonlySet<T> {
  if (current.has(value) === enabled) return current;
  const next = new Set(current);
  if (enabled) next.add(value);
  else next.delete(value);
  return next;
}

/** Updates a set for many values, cloning it at most once. */
export function updateSetValues<T>(
  current: ReadonlySet<T>,
  values: ReadonlySet<T>,
  enabled: boolean,
): ReadonlySet<T> {
  let changed = false;
  for (const value of values) {
    if (current.has(value) !== enabled) {
      changed = true;
      break;
    }
  }
  if (!changed) return current;
  const next = new Set(current);
  for (const value of values) {
    if (enabled) next.add(value);
    else next.delete(value);
  }
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

interface NestedStateUpdate<State, OuterKey, InnerKey> {
  readonly state: State;
  readonly current: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>;
  readonly outerKey: OuterKey;
  readonly innerKey: InnerKey;
  readonly enabled: boolean;
  readonly replace: (next: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>) => State;
}

/** Updates one nested interaction set and applies the changed state once. */
export function updateNestedState<State, OuterKey, InnerKey>(
  options: NestedStateUpdate<State, OuterKey, InnerKey>,
): State {
  const next = updateNestedSet(
    options.current,
    options.outerKey,
    options.innerKey,
    options.enabled,
  );
  return next === options.current ? options.state : options.replace(next);
}

/** Returns whether one nested interaction value is visible. */
export function isNestedValueVisible<OuterKey, InnerKey>(
  hidden: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>,
  outerKey: OuterKey,
  innerKey: InnerKey,
): boolean {
  return hidden.get(outerKey)?.has(innerKey) !== true;
}

interface NestedEmphasis<OuterKey, InnerKey, Override> {
  readonly hidden: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>;
  readonly highlighted: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>;
  readonly selected: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>;
  readonly overrides: ReadonlyMap<OuterKey, ReadonlyMap<InnerKey, Override>>;
  readonly hovered: boolean;
  readonly outerKey: OuterKey;
  readonly innerKey: InnerKey;
}

/** Returns whether one nested interaction value carries emphasis. */
export function isNestedValueEmphasized<OuterKey, InnerKey, Override>(
  options: NestedEmphasis<OuterKey, InnerKey, Override>,
): boolean {
  return (
    options.hovered ||
    options.hidden.get(options.outerKey)?.has(options.innerKey) === true ||
    options.highlighted.get(options.outerKey)?.has(options.innerKey) === true ||
    options.selected.get(options.outerKey)?.has(options.innerKey) === true ||
    options.overrides.get(options.outerKey)?.has(options.innerKey) === true
  );
}

/** Updates nested sets for many values, cloning each touched set once. */
export function updateNestedSets<OuterKey, InnerKey>(
  current: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>,
  values: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>,
  enabled: boolean,
): ReadonlyMap<OuterKey, ReadonlySet<InnerKey>> {
  let next: Map<OuterKey, ReadonlySet<InnerKey>> | undefined;
  for (const [outerKey, requested] of values) {
    const existing = current.get(outerKey);
    const nextValues = updateSetValues(existing ?? new Set<InnerKey>(), requested, enabled);
    if (nextValues === existing || (existing === undefined && nextValues.size === 0)) continue;
    next ??= new Map(current);
    if (nextValues.size === 0) next.delete(outerKey);
    else next.set(outerKey, nextValues);
  }
  return next ?? current;
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

/** Updates nested maps for many values, cloning each touched map once. */
export function updateNestedMaps<OuterKey, InnerKey, Value>(
  current: ReadonlyMap<OuterKey, ReadonlyMap<InnerKey, Value>>,
  values: ReadonlyMap<OuterKey, ReadonlyMap<InnerKey, Value>>,
  enabled: boolean,
): ReadonlyMap<OuterKey, ReadonlyMap<InnerKey, Value>> {
  let next: Map<OuterKey, ReadonlyMap<InnerKey, Value>> | undefined;
  for (const [outerKey, requested] of values) {
    const existing = current.get(outerKey);
    let nextValues: Map<InnerKey, Value> | undefined;
    for (const [innerKey, value] of requested) {
      const present = existing?.has(innerKey) === true;
      if (present === enabled) continue;
      nextValues ??= new Map(existing ?? []);
      if (enabled) nextValues.set(innerKey, value);
      else nextValues.delete(innerKey);
    }
    if (nextValues === undefined) continue;
    next ??= new Map(current);
    if (nextValues.size === 0) next.delete(outerKey);
    else next.set(outerKey, nextValues);
  }
  return next ?? current;
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

/** Visits members added to or removed from an immutable set. */
export function diffSetMembers<T>(
  previous: ReadonlySet<T>,
  next: ReadonlySet<T>,
  visit: (value: T) => void,
): void {
  if (previous === next) return;
  for (const value of previous) if (!next.has(value)) visit(value);
  for (const value of next) if (!previous.has(value)) visit(value);
}

/** Visits outer keys whose nested immutable set membership changed. */
export function diffNestedSetMembers<OuterKey, InnerKey>(
  previous: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>,
  next: ReadonlyMap<OuterKey, ReadonlySet<InnerKey>>,
  visit: (value: OuterKey) => void,
): void {
  if (previous === next) return;
  for (const [outerKey, values] of previous) {
    const nextValues = next.get(outerKey);
    if (nextValues === values) continue;
    if (nextValues === undefined || hasMissingMember(values, nextValues)) {
      visit(outerKey);
    }
  }
  for (const [outerKey, values] of next) {
    const previousValues = previous.get(outerKey);
    if (previousValues === values) continue;
    if (previousValues === undefined || hasMissingMember(values, previousValues)) {
      visit(outerKey);
    }
  }
}

/** Visits keys whose immutable map values changed by identity. */
export function diffMapValues<Key, Value>(
  previous: ReadonlyMap<Key, Value>,
  next: ReadonlyMap<Key, Value>,
  visit: (value: Key) => void,
): void {
  if (previous === next) return;
  for (const [key, value] of previous) if (next.get(key) !== value) visit(key);
  for (const [key, value] of next) if (previous.get(key) !== value) visit(key);
}

function hasMissingMember<T>(values: ReadonlySet<T>, other: ReadonlySet<T>): boolean {
  for (const value of values) if (!other.has(value)) return true;
  return false;
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

type NestedValues<Key> = { readonly keys: () => Iterable<Key> };

/** Appends nested references in deterministic outer-key and numeric-key order. */
export function appendSortedNestedRefs<OuterKey extends string, InnerKey extends number>(
  maps: readonly ReadonlyMap<OuterKey, NestedValues<InnerKey>>[],
  push: (outerKey: OuterKey, innerKey: InnerKey) => void,
): void {
  for (const map of maps) {
    for (const [outerKey, values] of sortedNestedEntries(map)) {
      for (const innerKey of sortedNumbers(values.keys())) push(outerKey, innerKey);
    }
  }
}

function sortedNestedEntries<
  OuterKey extends string,
  InnerKey,
  Values extends NestedValues<InnerKey>,
>(map: ReadonlyMap<OuterKey, Values>): Array<readonly [OuterKey, Values]> {
  return sortedStringMapEntries(map);
}

/** Returns string-keyed map entries in deterministic ascending key order. */
export function sortedStringMapEntries<Key extends string, Value>(
  map: ReadonlyMap<Key, Value>,
): Array<readonly [Key, Value]> {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
}

/** Returns numbers in deterministic ascending order. */
export function sortedNumbers<NumberValue extends number>(
  values: Iterable<NumberValue>,
): NumberValue[] {
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
