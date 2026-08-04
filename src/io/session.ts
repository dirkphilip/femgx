import type { Issue, IssueSeverity, SourcePosition } from "./diagnostics";
import { IoError } from "./diagnostics";
import { createModelBuilder, type FemModelBuilder } from "./build";
import type { FemModel } from "./model";
import { validateModel } from "./validate";
import { OperationCancelledError, type CancellationToken, type ProgressReporter } from "./progress";

/** Shared import options: cooperative cancellation and progress reporting. */
export interface ParseOptions {
  readonly token?: CancellationToken;
  readonly onProgress?: ProgressReporter;
  /** When true, abort on the first issue by throwing an {@link IoError}. */
  readonly strict?: boolean;
}

/**
 * The result of an import: the best-effort model plus every issue found.
 * An import never throws for malformed content unless `strict` is set.
 */
export interface ParseResult {
  readonly model: FemModel;
  readonly issues: readonly Issue[];
}

/**
 * The mutable state shared by the format readers: the accumulating builder, the
 * issue list, and helpers for diagnostics, cancellation, and progress. Create
 * one with `createParseSession` and finalize with `finishParse`.
 */
export interface ParseSession {
  readonly builder: FemModelBuilder;
  readonly issues: Issue[];
  /** Records an issue; in strict mode this throws immediately. */
  report(code: string, message: string, position?: SourcePosition, severity?: IssueSeverity): void;
  /** Throws {@link OperationCancelledError} when the token has been cancelled. */
  checkCancelled(): void;
  /** Reports progress as a fraction in [0, 1] plus a message. */
  progress(fraction: number, message: string): void;
}

/** Starts an import session; every format reader builds on one of these. */
export function createParseSession(options: ParseOptions = {}): ParseSession {
  const issues: Issue[] = [];
  const strict = options.strict ?? false;
  const token = options.token;
  const onProgress = options.onProgress;
  return {
    builder: createModelBuilder(),
    issues,
    report(code, message, position, severity = "error") {
      const issue: Issue = {
        code,
        severity,
        message,
        ...(position === undefined ? {} : { position }),
      };
      if (strict) {
        throw new IoError(message, [issue]);
      }
      issues.push(issue);
    },
    checkCancelled() {
      if (token?.cancelled === true) {
        throw new OperationCancelledError();
      }
    },
    progress(fraction, message) {
      onProgress?.({ fraction, message });
    },
  };
}

/**
 * Finalizes an import session: builds the model, appends any validation issues
 * found by `validateModel`, and returns the result. In strict mode an issue
 * list is thrown as an {@link IoError} instead.
 */
export function finishParse(session: ParseSession, options: ParseOptions = {}): ParseResult {
  const model = session.builder.build();
  const issues = [...session.issues, ...validateModel(model)];
  if (options.strict === true && issues.length > 0) {
    throw new IoError(`Import failed with ${issues.length} issue(s)`, issues);
  }
  return { model, issues };
}
