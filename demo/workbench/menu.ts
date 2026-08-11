import type { SelectTarget } from "../pick";

/** Small context-menu renderer owned by the demo workbench. */
export class WorkbenchMenu {
  private readonly menu: HTMLElement;
  private readonly edgesEnabled: () => boolean;
  private readonly diagnosticsEnabled: () => boolean;
  private readonly onAction: (action: string) => void;

  constructor(
    menu: HTMLElement,
    edgesEnabled: () => boolean,
    diagnosticsEnabled: () => boolean,
    onAction: (action: string) => void,
  ) {
    this.menu = menu;
    this.edgesEnabled = edgesEnabled;
    this.diagnosticsEnabled = diagnosticsEnabled;
    this.onAction = onAction;
  }

  install(signal: AbortSignal): void {
    this.menu.addEventListener(
      "click",
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-action]");
        if (button === null) return;
        const action = button.dataset["action"];
        if (action !== undefined) this.onAction(action);
        this.hide();
      },
      { signal },
    );
  }

  show(target: SelectTarget, x: number, y: number): void {
    this.menu.textContent = "";
    const title = document.createElement("div");
    title.className = "menu-title";
    title.textContent = targetLabel(target);
    this.menu.appendChild(title);
    this.menuButton("Highlight / Clear", "highlight");
    this.menuButton("Select / Deselect", "select");
    this.menuButton("Hide / Show instance", "hide-instance");
    this.menuButton("Hide / Show part", "hide-part");
    this.menuSection("Display");
    this.menuButton(this.edgesEnabled() ? "Hide edges" : "Overlay edges", "edges");
    this.menuButton(
      this.diagnosticsEnabled() ? "Diagnostics off" : "Diagnostics on",
      "diagnostics",
    );
    this.menuSection("View");
    this.menuButton("Fit to view", "fit-view");
    this.menuButton("Reset", "reset");
    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${y}px`;
    this.menu.hidden = false;
    this.clampToViewport(x, y);
  }

  showView(x: number, y: number): void {
    this.menu.textContent = "";
    this.menuSection("View");
    this.menuButton("Fit to view", "fit-view");
    this.menuButton("Clear selection", "clear-selection");
    this.menuButton("Show all", "show-all");
    this.menuButton("Reset view", "reset");
    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${y}px`;
    this.menu.hidden = false;
    this.clampToViewport(x, y);
  }

  hide(): void {
    this.menu.hidden = true;
  }

  private clampToViewport(x: number, y: number): void {
    const rect = this.menu.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const maxX = viewportWidth - rect.width - margin;
    const maxY = viewportHeight - rect.height - margin;
    this.menu.style.left = `${Math.min(x, Math.max(margin, maxX))}px`;
    this.menu.style.top = `${Math.min(y, Math.max(margin, maxY))}px`;
  }

  private menuButton(label: string, action: string): void {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset["action"] = action;
    this.menu.appendChild(button);
  }

  private menuSection(title: string): void {
    const section = document.createElement("div");
    section.className = "menu-section";
    const label = document.createElement("div");
    label.className = "menu-title";
    label.textContent = title;
    section.appendChild(label);
    this.menu.appendChild(section);
  }
}

function targetLabel(target: SelectTarget): string {
  switch (target.kind) {
    case "node":
      return `Node ${target.nodeId}`;
    case "face":
      return `Face ${target.faceKey}`;
    case "element":
      return `Element ${target.elementId}`;
    case "instance":
      return `Instance ${target.instanceId}`;
    case "part":
      return `Part ${target.partId}`;
  }
}
