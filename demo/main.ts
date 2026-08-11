import { queryDemoView } from "./view";
import { startWebGpuDemo } from "./webgpu-demo";

const testShaderFailure = new URLSearchParams(window.location.search).get("testShaderFailure");
if (testShaderFailure !== null) {
  (globalThis as Record<string, unknown>)["__FEMGX_TEST_SHADER_FAILURE__"] = testShaderFailure;
}

const view = queryDemoView();
void startWebGpuDemo({ view, canvas: view.canvas });
