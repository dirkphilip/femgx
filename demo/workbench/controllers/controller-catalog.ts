import { benchmarkCaseSpecs } from "../../benchmark/model";
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

interface CatalogModeOwner {
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
export function rememberCatalogModel(owner: CatalogModelOwner, model: WorkbenchModel): void {
  owner.catalog.rememberModel(model);
  owner.models = owner.catalog.models;
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
