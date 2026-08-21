<script lang="ts">
  import type { WorkbenchPresentationPort, WorkbenchSnapshot } from "../presentation/snapshot";
  import { controlValue } from "./control-value";

  let {
    workbench,
    playback,
  }: {
    workbench: WorkbenchPresentationPort | undefined;
    playback: WorkbenchSnapshot["analysis"]["playback"];
  } = $props();

  function setPlaybackIndex(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setResultPlaybackIndex(value);
  }

  function setPlaybackRate(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setResultPlaybackRate(value);
  }

  function formatOffset(value: number): string {
    return String(Math.abs(value) < 1e-9 ? 0 : Number(value.toPrecision(5)));
  }
</script>

{#if playback !== undefined}
  <section
    id="result-playback-controls"
    data-testid="result-playback-controls"
    class="analysis-section result-playback-controls"
    role="group"
    aria-labelledby="result-playback-heading"
  >
    <h3 id="result-playback-heading">{playback.label}</h3>
    <div class="result-playback-actions">
      <button
        type="button"
        data-testid="result-playback-previous"
        aria-label="Previous result snapshot"
        disabled={!playback.hasPrevious}
        onclick={() => workbench?.commands.previousResultPlayback()}>Previous</button
      >
      <button
        type="button"
        data-testid="result-playback-play"
        aria-label={playback.playing ? "Pause result playback" : "Play result playback"}
        aria-pressed={playback.playing}
        onclick={() => workbench?.commands.toggleResultPlayback()}
        >{playback.playing ? "Pause" : "Play"}</button
      >
      <button
        type="button"
        data-testid="result-playback-next"
        aria-label="Next result snapshot"
        disabled={!playback.hasNext}
        onclick={() => workbench?.commands.nextResultPlayback()}>Next</button
      >
    </div>
    <label for="result-playback-index">
      <span>Snapshot</span>
      <input
        id="result-playback-index"
        data-testid="result-playback-index"
        type="range"
        min="0"
        max={playback.count - 1}
        step="1"
        value={playback.index}
        oninput={setPlaybackIndex}
        aria-label="Result snapshot"
      />
    </label>
    <div class="result-playback-position" data-testid="result-playback-position" aria-live="polite">
      {playback.stepLabel} · t={formatOffset(playback.time)} · {playback.index + 1}/{playback.count}
    </div>
    <label for="result-playback-rate">
      <span>Rate</span>
      <select
        id="result-playback-rate"
        data-testid="result-playback-rate"
        aria-label="Result playback rate"
        value={String(playback.rate)}
        onchange={setPlaybackRate}
      >
        <option value="0.5">0.5×</option>
        <option value="1">1×</option>
        <option value="2">2×</option>
      </select>
    </label>
  </section>
{/if}
