import { isElementVisible, isTargetSelected, type InteractionState } from "@/entries/interaction";
import { elementTarget, type SelectTarget } from "../selection/pick";
import type {
  WorkbenchContextMenuSnapshot,
  WorkbenchMenuAction,
  WorkbenchMenuEntry,
} from "../results/snapshot";

/** Labels for target-specific selection actions rendered by the context menu. */
export interface WorkbenchMenuSelectionOptions {
  readonly selectionLabel?: string | undefined;
  readonly elementSelectionLabel?: string | undefined;
  readonly elementVisibilityLabel?: string | undefined;
}

/** Builds the context actions supported by the exact picked target. */
export function contextMenuSelectionOptions(
  target: SelectTarget,
  interaction: InteractionState,
): WorkbenchMenuSelectionOptions {
  const element = elementTarget(target);
  return {
    selectionLabel:
      target.kind === "element" ? undefined : targetSelectionLabel(target, interaction),
    elementSelectionLabel:
      element?.kind !== "element"
        ? undefined
        : isTargetSelected(interaction, element)
          ? "Deselect element"
          : "Select element",
    elementVisibilityLabel:
      element?.kind !== "element"
        ? undefined
        : isElementVisible(interaction, element)
          ? "Hide element"
          : "Show element",
  };
}

function targetSelectionLabel(target: SelectTarget, interaction: InteractionState): string {
  if (target.kind === "body") {
    return `${isTargetSelected(interaction, target) ? "Deselect" : "Select"} body`;
  }
  if (target.kind !== "node" && target.kind !== "face") return "Select / Deselect";
  return `${isTargetSelected(interaction, target) ? "Deselect" : "Select"} ${target.kind}`;
}

/** Stores context-menu semantics while Svelte owns the menu markup and events. */
export class WorkbenchMenu {
  private state: WorkbenchContextMenuSnapshot = hiddenMenu();

  constructor(
    private readonly edgesEnabled: () => boolean,
    private readonly diagnosticsEnabled: () => boolean,
    private readonly fitSelectionAvailable: () => boolean,
    private readonly onAction: (action: WorkbenchMenuAction) => void,
    private readonly onChanged: () => void,
  ) {}

  get snapshot(): WorkbenchContextMenuSnapshot {
    return this.state;
  }

  show(
    target: SelectTarget,
    x: number,
    y: number,
    options: WorkbenchMenuSelectionOptions = { selectionLabel: "Select / Deselect" },
  ): void {
    const entries: WorkbenchMenuEntry[] = [
      ...(target.kind === "part" || target.kind === "partOccurrence"
        ? [button("Instance this part…", "instance-part")]
        : []),
      button("Highlight / Clear", "highlight"),
      ...optionalButtons(options),
      button("Hide / Show instance", "hide-instance"),
      button("Hide / Show part", "hide-part"),
      section("Display"),
      button(this.edgesEnabled() ? "Hide edges" : "Overlay edges", "edges"),
      button(this.diagnosticsEnabled() ? "Hide diagnostics" : "Show diagnostics", "diagnostics"),
      section("View"),
      this.fitButton(),
      button(
        "Reset all",
        "reset",
        "Restore this model's initial visibility, selection, display, results, projection, and camera.",
      ),
    ];
    this.setState({ visible: true, x, y, title: targetLabel(target), entries });
  }

  showView(x: number, y: number): void {
    this.setState({
      visible: true,
      x,
      y,
      title: "View",
      entries: [
        button("Add mesh…", "add-mesh"),
        section("View"),
        this.fitButton(),
        button("Clear selection", "clear-selection"),
        button("Show all", "show-all"),
        button(
          "Reset all",
          "reset",
          "Restore this model's initial visibility, selection, display, results, projection, and camera.",
        ),
        section("Display"),
        button(this.diagnosticsEnabled() ? "Hide diagnostics" : "Show diagnostics", "diagnostics"),
      ],
    });
  }

  activate(action: WorkbenchMenuAction): void {
    if (!this.state.visible) return;
    this.onAction(action);
    this.hide();
  }

  hide(): void {
    if (!this.state.visible) return;
    this.setState(hiddenMenu());
  }

  private setState(next: WorkbenchContextMenuSnapshot): void {
    this.state = Object.freeze({ ...next, entries: Object.freeze([...next.entries]) });
    this.onChanged();
  }

  private fitButton(): WorkbenchMenuEntry {
    return this.fitSelectionAvailable()
      ? button(
          "Fit selection (Z)",
          "fit-selection",
          "Frame the visible selected geometry with the same interruptible camera action as Z.",
        )
      : button(
          "Fit model (Z)",
          "fit-selection",
          "Frame the complete model because no visible selection can be framed.",
        );
  }
}

function hiddenMenu(): WorkbenchContextMenuSnapshot {
  return { visible: false, x: 0, y: 0, title: "", entries: [] };
}

function optionalButtons(options: WorkbenchMenuSelectionOptions): WorkbenchMenuEntry[] {
  return [
    options.selectionLabel === undefined ? undefined : button(options.selectionLabel, "select"),
    options.elementSelectionLabel === undefined
      ? undefined
      : button(options.elementSelectionLabel, "select-element"),
    options.elementVisibilityLabel === undefined
      ? undefined
      : button(options.elementVisibilityLabel, "hide-element"),
  ].filter((entry): entry is WorkbenchMenuEntry => entry !== undefined);
}

function button(label: string, action: WorkbenchMenuAction, help?: string): WorkbenchMenuEntry {
  return { kind: "button", label, action, ...(help === undefined ? {} : { help }) };
}

function section(label: string): WorkbenchMenuEntry {
  return { kind: "section", label };
}

function targetLabel(target: SelectTarget): string {
  switch (target.kind) {
    case "body":
      return `Body ${target.bodyId}`;
    case "node":
      return `Node ${target.nodeId}`;
    case "face":
      return `Face ${target.elementId}/${target.faceIndex}`;
    case "element":
      return `Element ${target.elementId}`;
    case "partOccurrence":
      return `PartOccurrence ${target.partOccurrenceId}`;
    case "part":
      return `Part ${target.partId}`;
    case "edge":
      return `Edge ${target.key}`;
  }
}
