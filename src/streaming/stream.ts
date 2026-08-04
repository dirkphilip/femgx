import { chunkDataByteLength, compareChunks, type ChunkSource, type ParsedChunk } from "./chunk";
import { parseChunk, type ParseChunkOptions } from "./parser";
import type { RebaseOrigin } from "./rebase";

/** Options controlling a chunk stream. */
export interface ChunkStreamOptions {
  /** Parsing strategy; defaults to the main-thread {@link parseChunk}. */
  readonly parse?: (source: ChunkSource, options: ParseChunkOptions) => ParsedChunk;
  /** Local origin applied by the parser; see `wiki/large-model-streaming.md`. */
  readonly origin?: RebaseOrigin;
  /**
   * Maximum CPU bytes uploaded per {@link ChunkStream.tick}. Uploads larger
   * than the remaining budget are deferred to the next tick, which is the
   * backpressure that keeps frame pacing predictable. Defaults to unlimited.
   */
  readonly budgetBytesPerTick?: number;
  /** Abort signal; aborting cancels the stream before the next tick. */
  readonly signal?: AbortSignal;
  /**
   * Per-chunk visibility gate. Chunks rejected here are skipped entirely and
   * never reach the upload path, so hidden or off-screen chunks avoid upload.
   */
  readonly isVisible?: (source: ChunkSource) => boolean;
  /** Called once per parsed chunk, in deterministic model order. */
  readonly onChunk?: (chunk: ParsedChunk) => void;
}

/**
 * A progressive, budgeted upload pump over a deterministic chunk list.
 *
 * Each {@link ChunkStream.tick} advances the stream one budget slice: chunks
 * are parsed and emitted strictly in model order, off-screen or hidden chunks
 * are skipped without uploading, and a per-tick byte budget defers work to the
 * next tick. A stream can be cancelled (abort signal or {@link cancel}) and
 * disposed, which releases its pending chunk buffers.
 */
export interface ChunkStream {
  readonly total: number;
  /** Chunks parsed and emitted so far. */
  readonly loaded: number;
  /** Chunks skipped because they were hidden, off-screen, or after cancel. */
  readonly skipped: number;
  /** CPU bytes uploaded so far, including emitted chunk payloads. */
  readonly uploadedBytes: number;
  /** CPU bytes of chunks that have not been processed yet. */
  readonly pendingBytes: number;
  readonly done: boolean;
  readonly cancelled: boolean;
  readonly disposed: boolean;
  /** Processes the next budget slice; returns whether the stream is done. */
  tick(): boolean;
  /** Cancels the stream; remaining chunks are skipped on the next tick. */
  cancel(): void;
  /** Releases pending chunk buffers and stops the stream. */
  dispose(): void;
}

interface StreamState {
  readonly total: number;
  readonly pending: ChunkSource[];
  next: number;
  loaded: number;
  skipped: number;
  uploadedBytes: number;
  pendingBytes: number;
  cancelled: boolean;
  disposed: boolean;
  done: boolean;
}

/** Creates a chunk stream over `sources`; see {@link ChunkStream}. */
export function createChunkStream(
  sources: readonly ChunkSource[],
  options: ChunkStreamOptions = {},
): ChunkStream {
  const budget = options.budgetBytesPerTick ?? Number.POSITIVE_INFINITY;
  if (budget < 0 || Number.isNaN(budget)) {
    throw new Error("budgetBytesPerTick must be a non-negative number or Infinity");
  }
  return buildStream(initialState(sources), options, budget);
}

function buildStream(state: StreamState, options: ChunkStreamOptions, budget: number): ChunkStream {
  return {
    get total() {
      return state.total;
    },
    get loaded() {
      return state.loaded;
    },
    get skipped() {
      return state.skipped;
    },
    get uploadedBytes() {
      return state.uploadedBytes;
    },
    get pendingBytes() {
      return state.pendingBytes;
    },
    get done() {
      return state.done;
    },
    get cancelled() {
      return state.cancelled;
    },
    get disposed() {
      return state.disposed;
    },
    tick: () => tick(state, options, budget),
    cancel: () => {
      state.cancelled = true;
      state.done = true;
    },
    dispose: () => {
      state.disposed = true;
      state.done = true;
      state.next = state.pending.length;
      state.pendingBytes = 0;
      state.pending.length = 0;
    },
  };
}

function initialState(sources: readonly ChunkSource[]): StreamState {
  const pending = [...sources].sort(compareChunks);
  const totalBytes = sources.reduce((sum, source) => sum + chunkDataByteLength(source.data), 0);
  return {
    total: pending.length,
    pending,
    next: 0,
    loaded: 0,
    skipped: 0,
    uploadedBytes: 0,
    pendingBytes: totalBytes,
    cancelled: false,
    disposed: false,
    done: false,
  };
}

function tick(state: StreamState, options: ChunkStreamOptions, budget: number): boolean {
  if (state.disposed || state.cancelled || state.done) {
    return true;
  }
  if (options.signal?.aborted === true) {
    state.cancelled = true;
    state.done = true;
    return true;
  }
  let remaining = budget;
  while (state.next < state.pending.length && remaining >= 0) {
    const source = state.pending[state.next];
    if (source === undefined) {
      break;
    }
    const bytes = chunkDataByteLength(source.data);
    if (options.isVisible?.(source) === false) {
      state.next += 1;
      state.skipped += 1;
      state.pendingBytes -= bytes;
      continue;
    }
    if (bytes > remaining) {
      break;
    }
    const parseOptions: ParseChunkOptions =
      options.origin === undefined ? {} : { origin: options.origin };
    const parsed = (options.parse ?? parseChunk)(source, parseOptions);
    options.onChunk?.(parsed);
    state.next += 1;
    state.loaded += 1;
    state.uploadedBytes += bytes;
    state.pendingBytes -= bytes;
    remaining -= bytes;
  }
  state.done = state.next >= state.pending.length;
  return state.done;
}
