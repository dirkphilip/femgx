/// <reference types="vite/client" />

declare const __FEMGX_BUILD_TIMESTAMP__: string;
declare const __FEMGX_BUILD_SHA__: string;

declare module "*.svelte" {
  import type { Component } from "svelte";

  const component: Component;
  export default component;
}
