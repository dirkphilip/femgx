import { queryDemoView } from "./workbench/view";
import { startWebGpuDemo } from "./workbench/start";
import { readDemoHarnessOptions } from "./devtools/harness";
import { renderBuildInfo } from "./workbench/build-info";

const view = queryDemoView();
renderBuildInfo(view.buildInfo);
void startWebGpuDemo({
  view,
  canvas: view.canvas,
  ...readDemoHarnessOptions(),
});
