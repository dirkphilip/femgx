/** A progress update: `fraction` in [0, 1] plus a human-readable message. */
export interface ProgressUpdate {
  readonly fraction: number;
  readonly message: string;
}

/**
 * Receives progress updates from an import or export. Implementations may
 * throttle or drop updates; every update is best-effort.
 */
export type ProgressReporter = (update: ProgressUpdate) => void;

/** A no-op progress reporter, used as the default. */
export function noopProgress(_update: ProgressUpdate): void {}

/**
 * Cooperative cancellation token. It is a plain object so it is safe to create
 * and check inside a Web Worker; parsers poll it between records.
 */
export interface CancellationToken {
  readonly cancelled: boolean;
}

/** A cancellation token source: create a token, then cancel it when needed. */
export interface CancellationTokenSource {
  readonly token: CancellationToken;
  cancel(): void;
}

/** Creates a cancellation token source that starts un-cancelled. */
export function createCancellationToken(): CancellationTokenSource {
  let cancelled = false;
  return {
    token: {
      get cancelled(): boolean {
        return cancelled;
      },
    },
    cancel(): void {
      cancelled = true;
    },
  };
}

/** Thrown by parsers when a cancellation token has been cancelled. */
export class OperationCancelledError extends Error {
  constructor() {
    super("Import or export was cancelled");
    this.name = "OperationCancelledError";
  }
}
