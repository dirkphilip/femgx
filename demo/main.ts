import { queryResultsView, startResultsDemo } from "./results-demo";
import { createResultsFixture } from "./results-fixture";
import { queryDemoView } from "./view";
import { startWebGpuDemo } from "./webgpu-demo";

const view = queryDemoView();
void startWebGpuDemo({ view, canvas: view.canvas });

startResultsDemo(queryResultsView(), createResultsFixture());
