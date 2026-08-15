<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchSnapshot, WorkbenchStartupStatus } from "../snapshot";
  import BuildInfo from "./BuildInfo.svelte";
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

  let controller: WorkbenchController | undefined = $state();
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
    if (browser === undefined) return;
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
    if (typeof event !== "object" || event === null) return undefined;
    const value = Reflect.get(event, "key");
    return typeof value === "string" ? value : undefined;
  }

  function eventShiftKey(event: unknown): boolean {
    if (typeof event !== "object" || event === null) return false;
    return Reflect.get(event, "shiftKey") === true;
  }

  function preventDefault(event: unknown): void {
    if (typeof event !== "object" || event === null) return;
    const method = Reflect.get(event, "preventDefault");
    if (typeof method === "function") Reflect.apply(method, event, []);
  }

  function activeElement(): unknown {
    const document = Reflect.get(globalThis, "document");
    return typeof document === "object" && document !== null
      ? Reflect.get(document, "activeElement")
      : undefined;
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
    onclick={toggleNavigation}>{navigationOpen ? "Close" : "Menu"}</button
  >
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
    <ModelSource {controller} {snapshot} />
    <h2 class="sidebar-heading">Visibility</h2>
    <VisibilityTree {controller} visibility={snapshot?.hierarchy.visibility} />
  </aside>
  <ViewportWorkspace {controller} {snapshot} {startup} {navigationOpen} />
</main>
