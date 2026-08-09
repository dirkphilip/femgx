import { queryDemoView } from "./view";
import { startWebGpuDemo } from "./webgpu-demo";

const view = queryDemoView();
void startWebGpuDemo({ view, canvas: view.canvas });
