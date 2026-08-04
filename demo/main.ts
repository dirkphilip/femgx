import { createDemoFixture } from "./fixture";
import { queryResultsView, startResultsDemo } from "./results-demo";
import { createResultsFixture } from "./results-fixture";
import { queryDemoView } from "./view";
import { createWebGpuProbe } from "./webgpu-probe";
import { startWebGpuDemo } from "./webgpu-demo";

const view = queryDemoView();
const fixture = createDemoFixture(view.canvas.width, view.canvas.height);
const probe = createWebGpuProbe(fixture, view.canvas);
void startWebGpuDemo({ view, fixture, createRenderer: probe });

startResultsDemo(queryResultsView(), createResultsFixture());
