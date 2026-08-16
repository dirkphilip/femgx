import { parseVtk, type Issue } from "../../../src/entries/io";
import type { GlbSceneImport, importGlb } from "../../../src/entries/io/glb";
import { createVtkScene } from "../../fixtures/vtk-scene";
import type { ImportedModelData } from "./model";

/** Imports one supported local workbench file without mutating active state. */
export async function importModelFile(
  file: File,
  glbImporter: typeof importGlb,
): Promise<ImportedModelData> {
  switch (fileExtension(file.name)) {
    case "glb":
      return fromGlb(await glbImporter(await file.arrayBuffer()));
    case "vtk":
      return fromVtk(await file.text());
    default:
      throw new Error("Unsupported model file. Choose an ASCII .vtk or binary .glb file.");
  }
}

function fromGlb(imported: GlbSceneImport): ImportedModelData {
  return {
    scene: imported.scene,
    elementModels: new Map(),
    partNames: imported.partNames,
    partStyles: imported.partStyles,
    results: undefined,
    issues: imported.issues,
  };
}

function fromVtk(source: string): ImportedModelData {
  const parsed = parseVtk(source);
  const errors = parsed.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) throw new VtkImportError(errors);
  const scene = createVtkScene(parsed.model);
  return { ...scene, issues: parsed.issues };
}

function fileExtension(name: string): string {
  const separator = name.lastIndexOf(".");
  return separator < 0 ? "" : name.slice(separator + 1).toLowerCase();
}

class VtkImportError extends Error {
  constructor(issues: readonly Issue[]) {
    super(`VTK could not be opened: ${formatIssues(issues)}`);
    this.name = "VtkImportError";
  }
}

function formatIssues(issues: readonly Issue[]): string {
  const details = issues.slice(0, 3).map((issue) => issue.message);
  const suffix = issues.length > details.length ? ` (+${issues.length - details.length} more)` : "";
  return `${details.join("; ")}${suffix}`;
}
