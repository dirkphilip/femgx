<script lang="ts">
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchSnapshot } from "../snapshot";

  let {
    controller,
    snapshot,
  }: {
    controller: WorkbenchController | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();
</script>

<div class="touch-tool-rail" data-testid="touch-tool-rail" role="toolbar" aria-label="Touch tools">
  <button
    type="button"
    data-testid="touch-tool-navigate"
    aria-label="Navigate"
    title="Navigate: drag to orbit; use two fingers to pan and zoom"
    aria-pressed={(snapshot?.toolbar.touchInteractionMode ?? "navigate") === "navigate"}
    onclick={() => controller?.commands.setTouchInteractionMode("navigate")}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3v18M3 12h18M12 3l-3 3m3-3 3 3M21 12l-3-3m3 3-3 3M12 21l3-3m-3 3-3-3M3 12l3 3m-3-3 3-3"
      />
    </svg>
  </button>
  <button
    type="button"
    data-testid="touch-tool-box-select"
    aria-label="Box select"
    title="Box select: drag a rectangle over the model"
    aria-pressed={snapshot?.toolbar.touchInteractionMode === "box-select"}
    onclick={() => controller?.commands.setTouchInteractionMode("box-select")}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5h4M15 5h4v4M19 15v4h-4M9 19H5v-4M5 9V5M11 11l8 8m-3-1 3 1-1-3" />
    </svg>
  </button>
  <button
    type="button"
    data-testid="touch-tool-select-all"
    aria-label="Select all"
    title="Select all explicitly visible targets at the active granularity"
    onclick={() => controller?.commands.selectAll()}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M8 12l3 3 6-7" />
    </svg>
  </button>
</div>
