import { INSTANCE_STRIDE } from "../instance-record";

interface JournalStorage {
  readonly data: ArrayBuffer;
  readonly revisionJournal?: InstanceStorageRevisionJournal;
}

/** Rollback journal for a staged storage mirror; entries exist only for changed ranges. */
export interface InstanceStorageRevisionJournal {
  readonly records: Map<number, Uint8Array>;
  readonly orders: Map<Uint32Array, Map<number, number>>;
}

/** Starts a sparse CPU-mirror journal for one staged storage owner. */
export function createInstanceStorageRevisionJournal(): InstanceStorageRevisionJournal {
  return { records: new Map(), orders: new Map() };
}

/** Captures one record before a staged mutation reaches its retained CPU mirror. */
export function captureStagedInstanceRecord(storage: JournalStorage, slot: number): void {
  const journal = storage.revisionJournal;
  if (journal === undefined || journal.records.has(slot)) return;
  const bytes = new Uint8Array(storage.data, slot * INSTANCE_STRIDE, INSTANCE_STRIDE);
  journal.records.set(slot, bytes.slice());
}

/** Captures one order cell before a staged mutation reaches its retained CPU mirror. */
export function captureStagedOrderValue(
  storage: JournalStorage,
  mirror: Uint32Array,
  index: number,
): void {
  const journal = storage.revisionJournal;
  if (journal === undefined) return;
  let values = journal.orders.get(mirror);
  if (values === undefined) {
    values = new Map();
    journal.orders.set(mirror, values);
  }
  if (!values.has(index)) values.set(index, mirror[index] ?? 0);
}

/** Restores only staged CPU-mirror ranges after a failed revision transaction. */
export function rollbackStagedInstanceStorage(storage: JournalStorage): void {
  const journal = storage.revisionJournal;
  if (journal === undefined) return;
  const bytes = new Uint8Array(storage.data);
  for (const [slot, previous] of journal.records) bytes.set(previous, slot * INSTANCE_STRIDE);
  for (const [mirror, values] of journal.orders) {
    for (const [index, previous] of values) mirror[index] = previous;
  }
}
