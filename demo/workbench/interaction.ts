import {
  clientToCanvasCss,
  setHoveredElement,
  setHoveredFace,
  setHoveredInstance,
  setHoveredNode,
  type FemViewport,
  type InteractionState,
  type PartId,
  type PickTarget,
} from "../../src/index";
import { describePick } from "../inspect";
import { selectTarget, targetKey, type SelectTarget } from "../pick";
import { toggleHighlight, toggleSelection } from "./selection";
import type { WorkbenchMenu } from "./menu";

/** View and state hooks used by the asynchronous picking interaction layer. */
export interface WorkbenchInteractionOptions {
  readonly canvas: HTMLCanvasElement;
  readonly view: {
    readonly inspectionPanel: HTMLElement;
  };
  readonly viewport: () => FemViewport;
  readonly getInteraction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly partIdForInstance: (instanceId: string) => PartId | undefined;
  readonly partName: (partId: PartId) => string | undefined;
  readonly menu: WorkbenchMenu;
  readonly render: () => void;
}

/** Owns async pick ordering, hover state, click selection, and context targets. */
export class WorkbenchInteraction {
  private readonly options: WorkbenchInteractionOptions;
  private generation = 0;
  private downPosition: { readonly x: number; readonly y: number } | undefined;
  private target: SelectTarget | undefined;

  constructor(options: WorkbenchInteractionOptions) {
    this.options = options;
  }

  get contextTarget(): SelectTarget | undefined {
    return this.target;
  }

  pointerDown(event: PointerEvent): void {
    this.downPosition = { x: event.clientX, y: event.clientY };
  }

  pointerCancel(): void {
    this.downPosition = undefined;
  }

  async hover(event: PointerEvent): Promise<void> {
    const generation = ++this.generation;
    const hit = await this.resolve(event);
    if (generation !== this.generation) return;
    const target =
      hit === undefined
        ? undefined
        : selectTarget(hit, event, (id) => this.options.partIdForInstance(id));
    let interaction = this.options.getInteraction();
    interaction = setHoveredNode(
      interaction,
      target?.kind === "node"
        ? { instanceId: target.instanceId, nodeId: target.nodeId }
        : undefined,
    );
    interaction = setHoveredFace(
      interaction,
      target?.kind === "face"
        ? { instanceId: target.instanceId, elementId: target.elementId, faceKey: target.faceKey }
        : undefined,
    );
    interaction = setHoveredElement(
      interaction,
      target?.kind === "element"
        ? { instanceId: target.instanceId, elementId: target.elementId }
        : undefined,
    );
    interaction = setHoveredInstance(
      interaction,
      target !== undefined && target.kind !== "part" ? target.instanceId : undefined,
    );
    this.options.setInteraction(interaction);
    this.options.canvas.dataset["hovered"] = targetKey(target);
    this.options.canvas.dataset["pick"] = targetKey(hit);
    this.showPick(hit);
    this.options.render();
  }

  async click(event: MouseEvent): Promise<void> {
    const down = this.downPosition;
    this.downPosition = undefined;
    if (down !== undefined && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10)
      return;
    const generation = ++this.generation;
    const hit = await this.resolve(event);
    if (generation !== this.generation || hit === undefined) return;
    const target = selectTarget(hit, event, (id) => this.options.partIdForInstance(id));
    if (target === undefined) return;
    this.select(target);
  }

  select(target: SelectTarget): void {
    this.options.setInteraction(toggleSelection(this.options.getInteraction(), target));
    this.options.render();
  }

  highlight(target: SelectTarget): void {
    this.options.setInteraction(toggleHighlight(this.options.getInteraction(), target));
    this.options.render();
  }

  async contextMenu(event: MouseEvent): Promise<void> {
    event.preventDefault();
    const generation = ++this.generation;
    const hit = await this.resolve(event);
    if (generation !== this.generation) return;
    this.target =
      hit === undefined
        ? undefined
        : selectTarget(hit, event, (id) => this.options.partIdForInstance(id));
    if (this.target === undefined) {
      this.options.menu.hide();
      return;
    }
    this.showPick(hit);
    this.options.menu.show(this.target, event.clientX, event.clientY);
  }

  clearContext(): void {
    this.target = undefined;
    this.generation += 1;
    this.options.menu.hide();
  }

  destroy(): void {
    this.clearContext();
    this.downPosition = undefined;
  }

  private async resolve(event: {
    readonly clientX: number;
    readonly clientY: number;
  }): Promise<PickTarget | undefined> {
    const rect = this.options.canvas.getBoundingClientRect();
    const point = clientToCanvasCss(event.clientX, event.clientY, rect);
    return this.options.viewport().pick(point.x, point.y);
  }

  private showPick(hit: Parameters<typeof describePick>[0]): void {
    this.options.view.inspectionPanel.textContent = describePick(
      hit,
      (partId) => this.options.partName(partId),
      (id) => this.options.partIdForInstance(id),
    );
  }
}
