import type { BoxSelectionEvent, BoxSelectionRect } from "../../src/index";

/**
 * Renders the library's box-selection lifecycle onto one demo overlay element
 * and tracks whether a box drag is currently visible so the workbench can
 * suppress asynchronous hover while it is active.
 */
export class WorkbenchBoxPreview {
  private active = false;

  constructor(private readonly overlay: HTMLElement) {}

  /** True while a box drag is visible; hover must stay suppressed. */
  isActive(): boolean {
    return this.active;
  }

  /** Feeds one box-selection lifecycle event into the overlay. */
  handleEvent(event: BoxSelectionEvent): void {
    if (event.type === "start" || event.type === "change") {
      this.active = true;
      showBoxSelection(this.overlay, event.rect);
      return;
    }
    this.active = false;
    hideBoxSelection(this.overlay);
  }

  /** Hides the overlay and clears its transient inline geometry. */
  dispose(): void {
    this.active = false;
    hideBoxSelection(this.overlay);
  }
}

function showBoxSelection(overlay: HTMLElement, rect: BoxSelectionRect): void {
  overlay.hidden = false;
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.setAttribute("aria-hidden", "false");
}

function hideBoxSelection(overlay: HTMLElement): void {
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.removeProperty("left");
  overlay.style.removeProperty("top");
  overlay.style.removeProperty("width");
  overlay.style.removeProperty("height");
}
