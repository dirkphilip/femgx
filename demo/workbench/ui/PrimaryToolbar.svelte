<script lang="ts">
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchCommands, WorkbenchSnapshot } from "../snapshot";
  import AnalysisControls from "./AnalysisControls.svelte";

  let {
    controller,
    snapshot,
  }: {
    controller: WorkbenchController | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();

  type ModelFile = Parameters<WorkbenchCommands["openModel"]>[0];

  let modelFileInput: { click(): void; value: string } | undefined;

  function selectValue(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null) return undefined;
    const currentTarget = Reflect.get(event, "currentTarget");
    if (typeof currentTarget !== "object" || currentTarget === null) return undefined;
    const value = Reflect.get(currentTarget, "value");
    return typeof value === "string" ? value : undefined;
  }

  function setBackground(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setBackground(value);
  }

  function setSelectionGranularity(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setSelectionGranularity(value);
  }

  function setBoxSelectionStrategy(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setBoxSelectionStrategy(value);
  }

  function selectModel(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.selectModel(value);
  }

  function openModel(): void {
    modelFileInput?.click();
  }

  function openSelectedModel(event: unknown): void {
    const currentTarget = eventTarget(event);
    if (currentTarget === undefined) return;
    const files = Reflect.get(currentTarget, "files");
    if (files === null || typeof files !== "object") return;
    const file = Reflect.get(files, "0");
    if (!isModelFile(file)) return;
    const command = controller?.commands.openModel(file);
    if (command !== undefined) void command.then(resetModelFileInput, resetModelFileInput);
  }

  function resetModelFileInput(): void {
    if (modelFileInput !== undefined && "value" in modelFileInput) modelFileInput.value = "";
  }

  function eventTarget(event: unknown): object | undefined {
    if (typeof event !== "object" || event === null) return undefined;
    const target = Reflect.get(event, "currentTarget");
    return typeof target === "object" && target !== null ? target : undefined;
  }

  function isModelFile(value: unknown): value is ModelFile {
    return (
      typeof value === "object" &&
      value !== null &&
      "name" in value &&
      "size" in value &&
      "type" in value
    );
  }
</script>

<div class="toolbar">
  <div class="toolbar-row toolbar-row-primary">
    <div
      id="model-source"
      class="model-source"
      role="group"
      aria-label="Model source"
      aria-busy={snapshot?.model.loading ?? false}
    >
      <select
        id="model-select"
        data-testid="model-select"
        aria-label="Example model"
        value={snapshot?.model.active.id ?? ""}
        disabled={snapshot?.model.selectionDisabled ?? false}
        onchange={selectModel}
      >
        {#each snapshot?.model.available ?? [] as model (model.id)}
          <option value={model.id}
            >{model.source === "file" ? `Opened · ${model.name}` : model.name}</option
          >
        {/each}
      </select>
      <button
        id="open-model"
        data-testid="open-model"
        type="button"
        disabled={snapshot?.model.openDisabled ?? false}
        onclick={openModel}>Open model…</button
      >
      <input
        id="model-file"
        data-testid="model-file"
        class="visually-hidden"
        type="file"
        accept=".vtk,.glb,text/plain,model/gltf-binary"
        tabindex="-1"
        bind:this={modelFileInput}
        onchange={openSelectedModel}
      />
    </div>
    <button
      id="fit-view"
      data-testid="fit-view"
      type="button"
      aria-label={snapshot?.toolbar.fitSelectionAvailable ? "Fit selection" : "Fit model"}
      aria-keyshortcuts="Z"
      title={snapshot?.toolbar.fitSelectionAvailable
        ? "Frame the visible selected geometry. Press Z to use the same action."
        : "Frame the complete model because no visible selection can be framed. Press Z to use the same action."}
      onclick={() => controller?.commands.fitSelection()}
      >{snapshot?.toolbar.fitSelectionAvailable ? "Fit selection" : "Fit model"}</button
    >
    <select
      id="selection-granularity"
      data-testid="selection-granularity"
      aria-label="Selection granularity"
      aria-describedby="interaction-help"
      title="Choose whether click and box selection targets elements, faces, or nodes."
      value={snapshot?.toolbar.selectionGranularity ?? "element"}
      onchange={setSelectionGranularity}
    >
      <option value="element">Element</option>
      <option value="face">Face</option>
      <option value="node">Node</option>
    </select>
    <select
      id="box-selection-strategy"
      data-testid="box-selection-strategy"
      aria-label="Box selection"
      aria-describedby="interaction-help"
      title="Visible selects nearest visible samples; Through selects intersecting visible elements through occlusion."
      value={snapshot?.toolbar.boxSelectionStrategy ?? "visible-surface"}
      onchange={setBoxSelectionStrategy}
    >
      <option value="visible-surface">Visible</option>
      <option
        value="through-intersection"
        disabled={snapshot?.toolbar.selectionGranularity !== "element"}>Through</option
      >
    </select>
    <button
      id="hide-selected"
      data-testid="hide-selected"
      type="button"
      disabled={(snapshot?.hierarchy.selectedCount ?? 0) === 0}
      aria-label={`Hide selected ${snapshot?.hierarchy.selectedCount === 1 ? "element" : "elements"}`}
      title={snapshot?.hierarchy.selectedCount === 0
        ? "Select one or more elements to hide."
        : `Hide ${snapshot?.hierarchy.selectedCount} selected elements.`}
      onclick={() => controller?.commands.hideSelected()}
      >{snapshot?.hierarchy.selectedCount === 0
        ? "Hide selected"
        : `Hide selected (${snapshot?.hierarchy.selectedCount})`}</button
    >
    <button
      id="show-all"
      data-testid="show-all"
      type="button"
      aria-label="Show all"
      title="Restore all model visibility without changing selection or display settings."
      onclick={() => controller?.commands.showAll()}>Show all</button
    >
    <button
      id="viewport-toggle"
      data-testid="viewport-toggle"
      type="button"
      aria-pressed={snapshot?.toolbar.secondaryOpen ?? false}
      aria-label={snapshot?.toolbar.secondaryOpen
        ? "Close secondary viewport"
        : "Add secondary viewport"}
      disabled={snapshot?.toolbar.secondaryBusy ?? false}
      onclick={() => controller?.commands.toggleSecondaryViewport()}
      >{snapshot?.toolbar.secondaryBusy
        ? "Opening…"
        : snapshot?.toolbar.secondaryOpen
          ? "Close viewport"
          : "Add viewport"}</button
    >
    <button
      id="projection-toggle"
      data-testid="projection-toggle"
      type="button"
      aria-label={`Projection: ${snapshot?.toolbar.projection ?? "perspective"}`}
      onclick={() => controller?.commands.setProjection()}
      >{snapshot?.toolbar.projection === "orthographic" ? "Orthographic" : "Perspective"}</button
    >
  </div>
  <div class="toolbar-row toolbar-row-secondary">
    <label class="toolbar-background" for="background-select">
      <span class="toolbar-background-name">Background</span>
      <select
        id="background-select"
        data-testid="background-select"
        aria-label="Background"
        value={snapshot?.toolbar.background ?? "studio"}
        onchange={setBackground}
      >
        <option value="studio">Studio</option>
        <option value="white">White</option>
        <option value="dark">Dark</option>
      </select>
    </label>
    <button
      id="edge-overlay"
      data-testid="edge-overlay"
      type="button"
      aria-pressed={snapshot?.toolbar.edges ?? true}
      onclick={() => controller?.commands.toggleEdges()}>Edges</button
    >
    <button
      id="node-overlay"
      data-testid="node-overlay"
      type="button"
      aria-pressed={snapshot?.toolbar.nodes ?? true}
      onclick={() => controller?.commands.toggleNodes()}>Nodes</button
    >
    <button
      id="continuous-rendering"
      data-testid="continuous-rendering"
      type="button"
      aria-pressed={snapshot?.toolbar.continuous ?? false}
      title="Start a recurring render-loop sample for manual inspection."
      onclick={() => controller?.commands.toggleContinuous()}>Continuous</button
    >
    <AnalysisControls {controller} {snapshot} />
    <button
      id="reset"
      data-testid="reset"
      class="secondary"
      type="button"
      aria-label="Reset all"
      title="Restore this model's initial visibility, selection, display, results, projection, and camera."
      onclick={() => controller?.commands.reset()}>Reset all</button
    >
  </div>
  <div
    id="model-feedback"
    data-testid="model-feedback"
    role="status"
    aria-live="polite"
    data-kind={snapshot?.overlays.feedback?.kind}
    hidden={snapshot?.overlays.feedback === undefined}
  >
    {snapshot?.overlays.feedback?.message ?? ""}
  </div>
  <p id="interaction-help" data-testid="interaction-help" class="interaction-help">
    Element: click or drag to replace. Hold Ctrl or ⌘ to toggle. Shift keeps element selection. Alt
    selects an instance. Press Z to frame the visible selection, or the complete model when none is
    eligible.
  </p>
</div>
