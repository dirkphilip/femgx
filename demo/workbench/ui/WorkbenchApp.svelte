<script lang="ts">
  import { onDestroy } from "svelte";
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchSnapshot, WorkbenchStartupStatus } from "../snapshot";
  import BuildInfo from "./BuildInfo.svelte";
  import VisibilityTree from "./VisibilityTree.svelte";
  import ViewportWorkspace from "./ViewportWorkspace.svelte";

  let controller: WorkbenchController | undefined = $state();
  let snapshot: WorkbenchSnapshot | undefined = $state();
  let startup: WorkbenchStartupStatus | undefined = $state();
  let unsubscribe: (() => void) | undefined;

  /** Connects the presentation root to the already-created plain TypeScript owner. */
  export function connectWorkbench(next: WorkbenchController): void {
    unsubscribe?.();
    controller = next;
    unsubscribe = next.subscribe((current) => {
      snapshot = current;
    });
  }

  export function reportStartupFailure(status: WorkbenchStartupStatus): void {
    startup = status;
  }

  onDestroy(() => {
    unsubscribe?.();
  });
</script>

<main class="app">
  <aside class="sidebar">
    <div class="brand">
      <h1>FemGx</h1>
      <p class="subtitle">FE inspection</p>
      <a class="brand-link" href="./api/">API reference</a>
      <BuildInfo />
    </div>
    <h2 class="sidebar-heading">Visibility</h2>
    <VisibilityTree {controller} visibility={snapshot?.hierarchy.visibility} />
  </aside>
  <ViewportWorkspace {controller} {snapshot} {startup} />
</main>
