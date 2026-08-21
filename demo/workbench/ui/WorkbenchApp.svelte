<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type {
    WorkbenchPresentationPort,
    WorkbenchSnapshot,
    WorkbenchStartupStatus,
  } from "../presentation/snapshot";
  import BuildInfo from "./BuildInfo.svelte";
  import ElementDetail from "./ElementDetail.svelte";
  import ModelSource from "./ModelSource.svelte";
  import VisibilityTree from "./VisibilityTree.svelte";
  import ViewportWorkspace from "./ViewportWorkspace.svelte";

  interface FocusableElement {
    readonly hidden: boolean;
    readonly tabIndex: number;
    focus(): void;
    hasAttribute(name: string): boolean;
  }

  interface NavigationElement {
    querySelectorAll(selector: string): ArrayLike<FocusableElement>;
  }

  interface AppElement {
    style: { setProperty(name: string, value: string): void };
  }

  interface NavigationTrigger {
    focus(): void;
  }

  let workbench: WorkbenchPresentationPort | undefined = $state();
  let snapshot: WorkbenchSnapshot | undefined = $state();
  let startup: WorkbenchStartupStatus | undefined = $state();
  let appElement: AppElement | undefined = $state();
  let navigationElement: NavigationElement | undefined = $state();
  let navigationTrigger: NavigationTrigger | undefined = $state();
  let navigationOpen = $state(false);
  let phoneNavigation = $state(false);
  let unsubscribe: (() => void) | undefined;

  const PHONE_BREAKPOINT = 720;

  /** Connects the presentation root to the already-created plain TypeScript owner. */
  export function connectWorkbench(next: WorkbenchPresentationPort): void {
    unsubscribe?.();
    workbench = next;
    unsubscribe = next.subscribe((current) => {
      snapshot = current;
    });
  }

  export function reportStartupFailure(status: WorkbenchStartupStatus): void {
    startup = status;
  }

  function navigationFocusableElements(): FocusableElement[] {
    if (navigationElement === undefined) return [];
    return Array.from(
      navigationElement.querySelectorAll(
        'button, select, input:not([type="hidden"]), [href], [tabindex="0"]',
      ),
    ).filter(
      (element) => !element.hidden && !element.hasAttribute("disabled") && element.tabIndex >= 0,
    );
  }

  function openNavigation(): void {
    if (!phoneNavigation) return;
    navigationOpen = true;
    void Promise.resolve().then(() => navigationFocusableElements()[0]?.focus());
  }

  function closeNavigation(restoreFocus = true): void {
    navigationOpen = false;
    if (restoreFocus) void Promise.resolve().then(() => navigationTrigger?.focus());
  }

  function toggleNavigation(): void {
    if (navigationOpen) closeNavigation();
    else openNavigation();
  }

  onMount(() => {
    const browser = globalThis.window;
    const syncViewport = (): void => {
      phoneNavigation = browser.innerWidth <= PHONE_BREAKPOINT;
      const visualViewport = browser.visualViewport;
      const height = Math.max(360, Math.round(visualViewport?.height ?? browser.innerHeight));
      appElement?.style.setProperty("--workbench-viewport-height", `${height}px`);
      if (!phoneNavigation && navigationOpen) closeNavigation(false);
    };
    const handleKeydown = (event: unknown): void => {
      if (!navigationOpen) return;
      if (eventKey(event) === "Escape") {
        preventDefault(event);
        closeNavigation();
        return;
      }
      if (eventKey(event) !== "Tab") return;
      const focusable = navigationFocusableElements();
      if (focusable.length === 0) {
        preventDefault(event);
        navigationTrigger?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (eventShiftKey(event) && activeElement() === first) {
        preventDefault(event);
        last?.focus();
      } else if (!eventShiftKey(event) && activeElement() === last) {
        preventDefault(event);
        first?.focus();
      }
    };
    syncViewport();
    browser.addEventListener("resize", syncViewport);
    browser.addEventListener("orientationchange", syncViewport);
    browser.visualViewport?.addEventListener("resize", syncViewport);
    browser.addEventListener("keydown", handleKeydown);
    return () => {
      browser.removeEventListener("resize", syncViewport);
      browser.removeEventListener("orientationchange", syncViewport);
      browser.visualViewport?.removeEventListener("resize", syncViewport);
      browser.removeEventListener("keydown", handleKeydown);
    };
  });

  function eventKey(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null || !("key" in event)) return undefined;
    const value = event.key;
    return typeof value === "string" ? value : undefined;
  }

  function eventShiftKey(event: unknown): boolean {
    return (
      typeof event === "object" && event !== null && "shiftKey" in event && event.shiftKey === true
    );
  }

  function preventDefault(event: unknown): void {
    if (typeof event !== "object" || event === null || !("preventDefault" in event)) return;
    const method = event.preventDefault;
    if (typeof method === "function") method.call(event);
  }

  function activeElement(): unknown {
    return globalThis.document.activeElement;
  }

  onDestroy(() => {
    unsubscribe?.();
  });
</script>

<main bind:this={appElement} class="app">
  <button
    bind:this={navigationTrigger}
    class="navigation-toggle"
    data-testid="navigation-toggle"
    type="button"
    aria-controls="navigation-drawer"
    aria-expanded={navigationOpen}
    aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
    onclick={toggleNavigation}
  >
    <span class="navigation-toggle-icon" aria-hidden="true">
      {#if navigationOpen}
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M4 5h16v14H4zM9 5v14" />
        </svg>
      {/if}
    </span>
  </button>
  <button
    class="navigation-scrim"
    data-testid="navigation-scrim"
    type="button"
    aria-label="Close navigation"
    hidden={!navigationOpen}
    onclick={() => closeNavigation()}
  ></button>
  <aside
    bind:this={navigationElement}
    id="navigation-drawer"
    class="sidebar"
    class:drawer-open={navigationOpen}
    data-testid="navigation-drawer"
    role="navigation"
    aria-label="Workbench navigation"
    aria-hidden={phoneNavigation && !navigationOpen}
    inert={phoneNavigation && !navigationOpen}
  >
    <div class="brand">
      <h1>FemGx</h1>
      <p class="subtitle">FE inspection</p>
      <a class="brand-link" href="./api/">API reference</a>
      <BuildInfo />
    </div>
    <ModelSource {workbench} {snapshot} />
    <h2 class="sidebar-heading">Visibility</h2>
    {#if snapshot?.hierarchy.elementDetail === undefined}
      <VisibilityTree {workbench} visibility={snapshot?.hierarchy.visibility} />
    {:else}
      <ElementDetail {workbench} detail={snapshot.hierarchy.elementDetail} />
    {/if}
  </aside>
  <ViewportWorkspace {workbench} {snapshot} {startup} {navigationOpen} />
</main>
