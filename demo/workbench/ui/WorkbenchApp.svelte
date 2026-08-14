<script lang="ts">
  import { onDestroy } from "svelte";
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchSnapshot, WorkbenchStartupStatus } from "../snapshot";
  import PrimaryToolbar from "./PrimaryToolbar.svelte";
  import StatusOverlays from "./StatusOverlays.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import ResultLegend from "./ResultLegend.svelte";
  import VisibilityTree from "./VisibilityTree.svelte";

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
      <div id="build-info" class="build-info" data-testid="build-info"></div>
    </div>
    <h2 class="sidebar-heading">Visibility</h2>
    <VisibilityTree {controller} visibility={snapshot?.hierarchy.visibility} />
  </aside>
  <div id="viewport-workspace" data-secondary-open={snapshot?.toolbar.secondaryOpen ?? false}>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <section
      id="primary-scene"
      class="scene"
      aria-label="Primary viewport"
      data-pane="primary"
      tabindex="0"
    >
      <canvas
        id="view"
        data-testid="view-canvas"
        width="800"
        height="600"
        aria-describedby="interaction-help"
        aria-label="Finite-element model view"
      ></canvas>
      <div
        id="box-selection-overlay"
        data-testid="box-selection-overlay"
        aria-hidden="true"
        hidden
      ></div>
      <PrimaryToolbar {controller} {snapshot} />
      <ResultLegend {snapshot} />
      <StatusOverlays {snapshot} {startup} />
      <div class="scene-pane-label">Primary viewport</div>
    </section>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <section
      id="secondary-scene"
      class="scene-pane"
      aria-label="Secondary viewport"
      data-pane="secondary"
      tabindex="0"
      hidden={!(snapshot?.toolbar.secondaryOpen ?? false)}
    >
      <canvas
        id="secondary-view"
        data-testid="secondary-view-canvas"
        width="800"
        height="600"
        aria-describedby="interaction-help"
        aria-label="Secondary finite-element model view"
      ></canvas>
      <div
        id="secondary-box-selection-overlay"
        data-testid="secondary-box-selection-overlay"
        aria-hidden="true"
        hidden
      ></div>
      <div class="scene-pane-label">Secondary viewport</div>
    </section>
  </div>
  <ContextMenu {controller} {snapshot} />
</main>
