import type { Color } from "../../../src/entries/interaction";
import type { SectionAxis } from "../section-controls";

export interface WorkbenchResultLegendField {
  readonly id: string;
  readonly name: string;
  readonly location: "nodal" | "elemental";
  readonly unit: string;
}

export interface WorkbenchResultLegendColorStop {
  readonly offset: number;
  readonly color: Readonly<Color>;
}

export interface WorkbenchResultLegendSnapshot {
  readonly visible: boolean;
  readonly scalar:
    | {
        readonly field: WorkbenchResultLegendField;
        readonly range: { readonly min: number; readonly max: number };
        readonly palette: readonly WorkbenchResultLegendColorStop[];
        readonly missingColor: Readonly<Color>;
        readonly thresholds: readonly number[] | undefined;
      }
    | undefined;
  readonly deformation:
    | {
        readonly field: WorkbenchResultLegendField;
        readonly scale: number;
      }
    | undefined;
  readonly orientation:
    | {
        readonly field: WorkbenchResultLegendField;
        readonly glyph: "arrow" | "axis" | "triad";
        readonly transform: "direction" | "normal";
        readonly lengthScale: number;
        readonly widthPixels: number;
      }
    | undefined;
  readonly loads?:
    | {
        readonly field: {
          readonly id: string;
          readonly name: string;
          readonly location: "nodal";
          readonly forceUnit: string;
          readonly momentUnit: string;
        };
        readonly widthPixels: number;
      }
    | undefined;
  readonly section: {
    readonly axis: SectionAxis;
    readonly offset: number;
  };
}

/** Returns the immutable empty legend state used before a viewport is ready. */
export function emptyResultLegend(): WorkbenchResultLegendSnapshot {
  return {
    visible: false,
    scalar: undefined,
    deformation: undefined,
    orientation: undefined,
    loads: undefined,
    section: { axis: "off", offset: 0 },
  };
}
