import type { FemModel } from "./model";
import type { ProgressReporter } from "./progress";
import type { CancellationToken } from "./progress";
import type { ParseOptions, ParseResult } from "./session";
import { parseVtk } from "./vtk";
import { parseVtu } from "./vtu";
import { parseGmsh } from "./gmsh";
import { parseAbaqus } from "./abaqus";
import { writeVtk } from "./vtk-write";
import { writeVtu } from "./vtu-write";
import { writeGmsh } from "./gmsh-write";
import { writeAbaqus } from "./abaqus-write";

export {
  createParseSession,
  finishParse,
  type ParseOptions,
  type ParseResult,
  type ParseSession,
} from "./session";
export { parseVtk } from "./vtk";
export { parseVtu } from "./vtu";
export { parseGmsh } from "./gmsh";
export { parseAbaqus } from "./abaqus";
export { writeVtk } from "./vtk-write";
export { writeVtu } from "./vtu-write";
export { writeGmsh } from "./gmsh-write";
export { writeAbaqus } from "./abaqus-write";

/** The interchange formats the built-in adapters can read and write. */
export type IoFormat = "vtk" | "vtu" | "gmsh" | "abaqus";

/** Shared export options: cooperative cancellation and progress reporting. */
export interface WriteOptions {
  readonly token?: CancellationToken;
  readonly onProgress?: ProgressReporter;
}

/** Parses `source` in the given format and returns the model plus diagnostics. */
export function parse(source: string, format: IoFormat, options?: ParseOptions): ParseResult {
  switch (format) {
    case "vtk":
      return parseVtk(source, options);
    case "vtu":
      return parseVtu(source, options);
    case "gmsh":
      return parseGmsh(source, options);
    case "abaqus":
      return parseAbaqus(source, options);
  }
}

/** Writes `model` deterministically in the given format. */
export function write(model: FemModel, format: IoFormat, options?: WriteOptions): string {
  switch (format) {
    case "vtk":
      return writeVtk(model, options);
    case "vtu":
      return writeVtu(model, options);
    case "gmsh":
      return writeGmsh(model, options);
    case "abaqus":
      return writeAbaqus(model, options);
  }
}
