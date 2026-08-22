/** Narrow lifecycle boundary shared by stable capability owners. */
export interface ViewportLifecycleBoundary {
  ensureAlive(): void;
  readonly isBatching: boolean;
  invalidate(): void;
}
