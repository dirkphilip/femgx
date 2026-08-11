import type { ElementShape } from "../elements/shapes";
import type { Float64Buffer, Uint32Buffer } from "./growable";
import type { ParseSession } from "./session";

/** A completed attribute array collected from POINT_DATA or CELL_DATA. */
export interface ArrayBlock {
  readonly location: "node" | "element";
  readonly name: string;
  readonly components: number;
  readonly count: number;
  readonly values: Float64Array;
}

type VtkMode = "top" | "points" | "cells" | "cell-types" | "data" | "field" | "skip";

/** Mutable state shared by the VTK legacy reader's helper modules. */
export interface VtkState {
  readonly session: ParseSession;
  mode: VtkMode;
  pointsRemaining: number;
  nodeIds: number[];
  coords: number[];
  nextNodeId: number;
  cellsRemaining: number;
  cellStarts: Uint32Buffer;
  cellConnectivity: Uint32Buffer;
  cellTypesRemaining: number;
  cellTypes: Uint32Buffer;
  cellCount: number;
  sectionCount: number;
  location: "node" | "element";
  arrayName: string;
  components: number;
  arrayValues: Float64Buffer;
  fieldRemaining: number;
  dataBlocks: ArrayBlock[];
  openShape: ElementShape | undefined;
}
