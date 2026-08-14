import { mount } from "svelte";
import WorkbenchApp from "./workbench/ui/WorkbenchApp.svelte";
import { queryDemoView } from "./workbench/view";
import { startWebGpuDemo } from "./workbench/start";
import { readDemoHarnessOptions } from "./devtools/harness";
import { renderBuildInfo } from "./workbench/build-info";
import type { WorkbenchController } from "./workbench/controller";
import type { WorkbenchStartupStatus } from "./workbench/snapshot";

interface WorkbenchAppHandle {
  connectWorkbench(controller: WorkbenchController): void;
  reportStartupFailure(status: WorkbenchStartupStatus): void;
}

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) throw new Error("The workbench app root is missing");
const workbenchApp = mount(WorkbenchApp, { target: app }) as unknown as WorkbenchAppHandle;

const view = queryDemoView();
renderBuildInfo(view.buildInfo);
const controller = await startWebGpuDemo({
  view,
  canvas: view.canvas,
  reportStartupFailure: workbenchApp.reportStartupFailure.bind(workbenchApp),
  ...readDemoHarnessOptions(),
});
if (controller !== undefined) workbenchApp.connectWorkbench(controller);
