<script lang="ts">
  import type { WorkbenchController } from "../controllers/controller";
  import type { WorkbenchCommands, WorkbenchSnapshot } from "../results/snapshot";

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

<div
  id="model-source"
  class="model-source"
  role="group"
  aria-label="Model source"
  aria-busy={snapshot?.model.loading ?? false}
>
  <label class="model-source-label" for="model-select">Model</label>
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
