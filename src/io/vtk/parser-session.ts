import type { Issue, IssueSeverity, SourcePosition } from "../diagnostics";
import { IoError } from "../diagnostics";
import { createModelBuilder, type FemModelBuilder } from "../model-builder";
import type { FemModel } from "../fem-model";
import { validateModel } from "../model-validation";

/**
 * Shared import options.
 * @category Import and export
 */
export interface ParseOptions {
  /** When true, abort on the first issue by throwing an {@link IoError}. */
  readonly strict?: boolean;
}

/**
 * The result of an import: the best-effort model plus every issue found.
 * An import never throws for malformed content unless `strict` is set.
 * @category Import and export
 */
export interface ParseResult {
  readonly model: FemModel;
  readonly issues: readonly Issue[];
}

/**
 * Mutable state shared by the VTK reader: the accumulating builder and issue
 * list. Create with `createParseSession` and finalize with `finishParse`.
 */
export interface ParseSession {
  readonly builder: FemModelBuilder;
  readonly issues: Issue[];
  /** Records an issue; in strict mode this throws immediately. */
  report(code: string, message: string, position?: SourcePosition, severity?: IssueSeverity): void;
}

/** Starts an import session for the VTK legacy reader. */
export function createParseSession(options: ParseOptions = {}): ParseSession {
  const issues: Issue[] = [];
  const strict = options.strict ?? false;
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
    throw new IoError(`Import failed with ${String(issues.length)} issue(s)`, issues);
  }
  return { model, issues };
}
