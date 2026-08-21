<script lang="ts">
  import type { WorkbenchController } from "../controllers/controller";
  import type { WorkbenchSnapshot } from "../results/snapshot";

  let {
    controller,
    snapshot,
  }: {
    controller: WorkbenchController | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();
  let copies = $state("1");
  let spacing = $state("1");
  let dialog = $derived(snapshot?.overlays.livePartDialog);

  function submit(): void {
    controller?.commands.applyLivePartEdit(copies, spacing);
  }
</script>

{#if dialog !== undefined}
  <div class="live-part-backdrop" role="presentation">
    <form
      class="live-part-dialog"
      data-testid="live-part-dialog"
      onsubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2>{dialog.kind === "add" ? "Add mesh" : "Instance this part"}</h2>
      <p>
        {#if dialog.kind === "add"}
          Add one reusable Hex8 box and its placements.
        {:else}
          Add placements that reference Part {dialog.partId}{dialog.partName === undefined
            ? ""
            : ` · ${dialog.partName}`}.
        {/if}
      </p>
      <label
        >Copies <input
          data-testid="live-part-copies"
          type="number"
          min="1"
          max="100000"
          bind:value={copies}
        /></label
      >
      <label
        >Spacing <input
          data-testid="live-part-spacing"
          type="number"
          min="0.001"
          step="any"
          bind:value={spacing}
        /></label
      >
      <output
        >{copies || "0"} placement{copies === "1" ? "" : "s"} in a deterministic X/Z grid</output
      >
      <div class="live-part-actions">
        <button type="button" onclick={() => controller?.commands.cancelLivePartEdit()}
          >Cancel</button
        >
        <button type="submit" data-testid="live-part-apply">Apply</button>
      </div>
    </form>
  </div>
{/if}
