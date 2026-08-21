<script lang="ts">
  import { onMount } from "svelte";
  import type {
    WorkbenchMenuEntry,
    WorkbenchPresentationPort,
    WorkbenchSnapshot,
  } from "../presentation/snapshot";

  let {
    workbench,
    snapshot,
  }: {
    workbench: WorkbenchPresentationPort | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();
  let menuElement: unknown = $state();

  interface MenuElement {
    getBoundingClientRect(): { readonly width: number; readonly height: number };
    style: { left: string; top: string };
  }

  onMount(() => {
    const browser = globalThis.window;
    const closeOutside = (event: unknown): void => {
      const target =
        typeof event === "object" && event !== null && "target" in event ? event.target : undefined;
      if (
        typeof target === "object" &&
        target !== null &&
        menuElement !== null &&
        typeof menuElement === "object" &&
        !menuContains(target)
      ) {
        workbench?.commands.clearContextMenu();
      }
    };
    const closeWithEscape = (event: unknown): void => {
      if (typeof event === "object" && event !== null && "key" in event && event.key === "Escape") {
        workbench?.commands.clearContextMenu();
      }
    };
    const repositionMenu = (): void => positionMenu();
    browser.addEventListener("click", closeOutside);
    browser.addEventListener("keydown", closeWithEscape);
    browser.addEventListener("resize", repositionMenu);
    return () => {
      browser.removeEventListener("click", closeOutside);
      browser.removeEventListener("keydown", closeWithEscape);
      browser.removeEventListener("resize", repositionMenu);
    };
  });

  $effect(() => {
    if (snapshot?.overlays.contextMenu.visible) {
      void Promise.resolve().then(positionMenu);
    }
  });

  function positionMenu(): void {
    const menu = snapshot?.overlays.contextMenu;
    const browser = globalThis.window;
    if (!menu?.visible || !isMenuElement(menuElement)) return;
    const bounds = menuElement.getBoundingClientRect();
    const x = Math.max(8, Math.min(menu.x, browser.innerWidth - bounds.width - 8));
    const y = Math.max(8, Math.min(menu.y, browser.innerHeight - bounds.height - 8));
    menuElement.style.left = `${x}px`;
    menuElement.style.top = `${y}px`;
  }

  function isMenuElement(value: unknown): value is MenuElement {
    return (
      typeof value === "object" &&
      value !== null &&
      "getBoundingClientRect" in value &&
      typeof value.getBoundingClientRect === "function" &&
      "style" in value &&
      typeof value.style === "object" &&
      value.style !== null
    );
  }

  function activate(entry: WorkbenchMenuEntry): void {
    if (entry.kind === "button" && entry.action !== undefined) {
      workbench?.commands.contextMenuAction(entry.action);
    }
  }

  function menuContains(target: object): boolean {
    if (menuElement === null || typeof menuElement !== "object" || !("contains" in menuElement)) {
      return false;
    }
    const contains = menuElement.contains;
    return typeof contains === "function" && contains.call(menuElement, target) === true;
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
        data-testid={entry.action === undefined ? undefined : `context-action-${entry.action}`}
        title={entry.help}
        aria-label={entry.label}
        onclick={() => activate(entry)}>{entry.label}</button
      >
    {/if}
  {/each}
</div>
