<script lang="ts">
  import { onMount } from "svelte";
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchMenuEntry, WorkbenchSnapshot } from "../snapshot";

  let {
    controller,
    snapshot,
  }: {
    controller: WorkbenchController | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();
  let menuElement: unknown = $state();

  interface BrowserWindow {
    addEventListener(type: string, listener: (event: unknown) => void): void;
    removeEventListener(type: string, listener: (event: unknown) => void): void;
  }

  onMount(() => {
    const browser = Reflect.get(globalThis, "window") as BrowserWindow | undefined;
    if (browser === undefined) return;
    const closeOutside = (event: unknown): void => {
      const eventObject = typeof event === "object" && event !== null ? event : {};
      const target = Reflect.get(eventObject, "target");
      if (
        typeof target === "object" &&
        target !== null &&
        menuElement !== null &&
        typeof menuElement === "object" &&
        !menuContains(target)
      ) {
        controller?.commands.clearContextMenu();
      }
    };
    const closeWithEscape = (event: unknown): void => {
      const eventObject = typeof event === "object" && event !== null ? event : {};
      if (Reflect.get(eventObject, "key") === "Escape") controller?.commands.clearContextMenu();
    };
    browser.addEventListener("click", closeOutside);
    browser.addEventListener("keydown", closeWithEscape);
    return () => {
      browser.removeEventListener("click", closeOutside);
      browser.removeEventListener("keydown", closeWithEscape);
    };
  });

  function activate(entry: WorkbenchMenuEntry): void {
    if (entry.kind === "button" && entry.action !== undefined) {
      controller?.commands.contextMenuAction(entry.action);
    }
  }

  function menuContains(target: object): boolean {
    if (menuElement === null || typeof menuElement !== "object") return false;
    const contains = Reflect.get(menuElement, "contains");
    return (
      typeof contains === "function" && Reflect.apply(contains, menuElement, [target]) === true
    );
  }
</script>

<div
  bind:this={menuElement}
  id="context-menu"
  class="context-menu"
  data-testid="context-menu"
  role="menu"
  hidden={!(snapshot?.overlays.contextMenu.visible ?? false)}
  style={`left: max(8px, min(${snapshot?.overlays.contextMenu.x ?? 0}px, calc(100vw - 240px))); top: max(8px, min(${snapshot?.overlays.contextMenu.y ?? 0}px, calc(100vh - 420px)))`}
>
  {#if snapshot?.overlays.contextMenu.title}
    <div class="menu-title">{snapshot.overlays.contextMenu.title}</div>
  {/if}
  {#each snapshot?.overlays.contextMenu.entries ?? [] as entry (entry.kind + entry.label + (entry.action ?? ""))}
    {#if entry.kind === "section"}
      <div class="menu-section"><div class="menu-title">{entry.label}</div></div>
    {:else}
      <button
        type="button"
        role="menuitem"
        data-action={entry.action}
        title={entry.help}
        aria-label={entry.label}
        onclick={() => activate(entry)}>{entry.label}</button
      >
    {/if}
  {/each}
</div>
