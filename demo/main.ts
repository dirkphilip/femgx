import { queryDemoView } from "./workbench/view";
import { startWebGpuDemo } from "./workbench/start";
import { readDemoHarnessOptions } from "./devtools/harness";

const view = queryDemoView();
void startWebGpuDemo({
  view,
  canvas: view.canvas,
  ...readDemoHarnessOptions(),
});
