import { benchmarkCaseSpecs, denseTet4BenchmarkSpec } from "../../benchmark/model";
import { parseTet4Cells } from "../../benchmark/dense-tet4";
import { createLazyBenchmarkModel, type WorkbenchModel } from "../models/model";
import { WorkbenchModelCatalog, type WorkbenchCatalogMode } from "../models/model-catalog";
import type { WorkbenchModelSession } from "../models/model-session";

/** Builds the demo catalog while retaining only empty benchmark placeholders. */
export function createWorkbenchModelCatalog(
  ordinaryModels: readonly WorkbenchModel[],
): WorkbenchModelCatalog {
  return new WorkbenchModelCatalog(
    ordinaryModels,
    benchmarkCaseSpecs(true).map(createLazyBenchmarkModel),
  );
}

export interface CatalogModeOwner {
  readonly catalog: WorkbenchModelCatalog;
  readonly modelSession: Pick<WorkbenchModelSession, "cancel" | "setModel">;
  models: readonly WorkbenchModel[];
  render(): void;
}

type CatalogModelOwner = Pick<CatalogModeOwner, "catalog" | "models">;

/** Selects a model from the active catalog and starts its session. */
export function setModelForOwner(owner: CatalogModeOwner, id: string): void {
  if (!owner.catalog.select(id)) return;
  owner.models = owner.catalog.models;
  owner.modelSession.setModel(id);
}

/** Remembers a successfully activated model in its catalog. */
export function rememberCatalogModel(
  owner: CatalogModelOwner,
  model: WorkbenchModel,
): WorkbenchModel {
  const retainedModel = owner.catalog.rememberModel(model);
  owner.models = owner.catalog.models;
  return retainedModel;
}

/** Changes catalogs, cancels stale builds, and restores a remembered selection. */
export function setCatalogModeForOwner(owner: CatalogModeOwner, mode: WorkbenchCatalogMode): void {
  if (mode === owner.catalog.mode) return;
  owner.modelSession.cancel();
  const rememberedId = owner.catalog.setMode(mode);
  owner.models = owner.catalog.models;
  if (rememberedId === "") owner.render();
  else setModelForOwner(owner, rememberedId);
}

/** Enters Performance Lab and lazily meshes a cubic Tet4 solid of the given cell count. */
export function meshTet4ForOwner(owner: CatalogModeOwner, cells: number): void {
  const valid = parseTet4Cells(String(cells));
  if (valid === undefined) return;
  const spec = denseTet4BenchmarkSpec(valid);
  owner.catalog.ensurePerformanceModel(createLazyBenchmarkModel(spec));
  if (owner.catalog.mode !== "performance") {
    owner.modelSession.cancel();
    owner.catalog.setMode("performance");
  }
  owner.models = owner.catalog.models;
  setModelForOwner(owner, spec.id);
}
