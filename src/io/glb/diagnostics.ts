import { IoError, type Issue } from "../diagnostics";
import type { GlbIssueCode } from "./types";

/** Small internal collector shared by the GLB parser and scene mapper. */
export class GlbDiagnostics {
  private readonly entries: Issue[] = [];
  private readonly warningKeys = new Set<string>();

  public constructor(private readonly strict: boolean) {}

  public info(code: GlbIssueCode, message: string): void {
    this.entries.push({ code, severity: "info", message });
  }

  public warning(code: GlbIssueCode, message: string, key: string = code): void {
    if (this.warningKeys.has(key)) return;
    this.warningKeys.add(key);
    this.entries.push({ code, severity: "warning", message });
  }

  public fatal(code: GlbIssueCode, message: string): never {
    throw new IoError(message, [{ code, severity: "error", message }]);
  }

  public finish(): readonly Issue[] {
    if (this.strict && this.entries.some((issue) => issue.severity === "warning")) {
      throw new IoError("GLB import rejected in strict mode because it produced warnings", [
        ...this.entries,
      ]);
    }
    return [...this.entries];
  }
}

/** Converts an arbitrary parser failure into the public GLB diagnostic boundary. */
export function parseFailure(diagnostics: GlbDiagnostics, error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  return diagnostics.fatal("glb-parse-failure", `Unable to parse GLB bytes: ${detail}`);
}
