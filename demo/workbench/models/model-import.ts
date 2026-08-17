import type { GlbSceneImport, importGlb } from "../../../src/entries/io/glb";
import type { ImportedModelData } from "./model";

/** Imports one supported local workbench file without mutating active state. */
export async function importModelFile(
  file: File,
  glbImporter: typeof importGlb,
): Promise<ImportedModelData> {
  switch (fileExtension(file.name)) {
    case "glb":
      return fromGlb(await glbImporter(await file.arrayBuffer()));
    default:
      throw new Error("Unsupported model file. Choose a binary .glb file.");
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

function fileExtension(name: string): string {
  const separator = name.lastIndexOf(".");
  return separator < 0 ? "" : name.slice(separator + 1).toLowerCase();
}
