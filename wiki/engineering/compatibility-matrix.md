# WebGPU compatibility notes

WebGPU is the product's only rendering backend (see
[[requirements/product-scope|product scope contract]]), so the compatibility
contract is intentionally small: a modern browser with a working WebGPU device.
There is no product capability-tier ladder.

## Product contract

- A renderer requires a working WebGPU device.
- `queryWebGpuSupport()` reports a typed supported/unsupported result for
  callers that want to branch before creating a renderer.
- A missing or failed WebGPU device produces the explicit unsupported contract;
  it does not select a second renderer.

There is deliberately no CPU rendering tier and no SwiftShader-as-product lane.
See [[rendering/platform-support|Platform support]] for device loss, recovery,
and unsupported diagnostics.

## Validation lanes

- `npm run test:e2e` is the local real-WebGPU Chrome lane for rendering,
  interaction, picking, pixels, and recovery.
- `npm run test:e2e:ci` is the CI no-GPU lane; it verifies the explicit
  unsupported contract and is not a full renderer substitute.
- `npm run bench:webgpu` is an opt-in capacity measurement, not a compatibility
  tier or a universal performance guarantee.

Related: [[rendering/webgpu-e2e|WebGPU browser e2e lane]],
[[rendering/platform-support|Platform support]],
[[engineering/quality-gate|Quality gate]].

[engineering/quality-gate|Quality gate]: quality-gate.md
[rendering/platform-support|Platform support]: ../rendering/platform-support.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: ../rendering/webgpu-e2e.md
[requirements/product-scope|product scope contract]: ../requirements/product-scope.md
