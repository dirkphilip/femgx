import { createGalleryPreset } from "../src/fixture/presets";
import { queryResultsView, startResultsDemo } from "./results-demo";
import { createResultsFixture } from "./results-fixture";
import { queryDemoView } from "./view";
import { createWebGpuProbe } from "./webgpu-probe";
import { startWebGpuDemo } from "./webgpu-demo";

const view = queryDemoView();
const preset = createGalleryPreset();
const probe = createWebGpuProbe(preset, view.canvas);
void startWebGpuDemo({ view, canvas: view.canvas, preset, createRenderer: probe });

startResultsDemo(queryResultsView(), createResultsFixture());
