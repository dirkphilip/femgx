import { mount } from "svelte";
import WorkbenchApp from "./workbench/ui/WorkbenchApp.svelte";
import { queryDemoView } from "./workbench/view";
import { startWebGpuDemo } from "./workbench/start";
import { readDemoHarnessOptions } from "./devtools/harness";
import { renderBuildInfo } from "./workbench/build-info";

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) throw new Error("The workbench app root is missing");
mount(WorkbenchApp, { target: app });

const view = queryDemoView();
renderBuildInfo(view.buildInfo);
void startWebGpuDemo({
  view,
  canvas: view.canvas,
  ...readDemoHarnessOptions(),
});
