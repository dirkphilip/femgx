import type { FemModel } from "./model";
import type { ParseOptions, ParseResult } from "./session";
import { parseVtk } from "./vtk";
import { writeVtk } from "./vtk-write";

export {
  createParseSession,
  finishParse,
  type ParseOptions,
  type ParseResult,
  type ParseSession,
} from "./session";
export { parseVtk } from "./vtk";
export { writeVtk } from "./vtk-write";

/** The single supported interchange format. */
export type IoFormat = "vtk";

/** Parses VTK legacy ASCII and returns the model plus diagnostics. */
export function parse(source: string, options?: ParseOptions): ParseResult {
  return parseVtk(source, options);
}

/** Writes `model` as VTK legacy ASCII. */
export function write(model: FemModel): string {
  return writeVtk(model);
}
