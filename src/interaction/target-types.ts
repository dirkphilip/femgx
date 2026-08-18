import type { ElementId, NodeId } from "../elements/element";
import type { EdgeKey } from "../elements/edges";
import type { BodyId, PartId } from "../geometry/part";
import type { PartOccurrenceId } from "../scene/types";

/**
 * One stable identity that can be selected, highlighted, or hovered.
 * @category Interaction and picking
 */
export type InteractionTarget =
  | {
      /** Part-level interaction target. */
      readonly kind: "part";
      /** Stable reusable part identifier. */
      readonly partId: PartId;
    }
  | {
      /** Placed-part-occurrence interaction target. */
      readonly kind: "partOccurrence";
      /** Stable expanded part-occurrence identifier. */
      readonly partOccurrenceId: PartOccurrenceId;
    }
  | {
      /** Body-occurrence interaction target. */
      readonly kind: "body";
      /** Stable expanded part-occurrence identifier. */
      readonly partOccurrenceId: PartOccurrenceId;
      /** Stable body identifier within the part. */
      readonly bodyId: BodyId;
    }
  | {
      /** Element-occurrence interaction target. */
      readonly kind: "element";
      /** Stable expanded part-occurrence identifier. */
      readonly partOccurrenceId: PartOccurrenceId;
      /** Stable authored element identifier. */
      readonly elementId: ElementId;
    }
  | {
      /** Face-occurrence interaction target. */
      readonly kind: "face";
      /** Stable expanded part-occurrence identifier. */
      readonly partOccurrenceId: PartOccurrenceId;
      /** Stable authored element identifier. */
      readonly elementId: ElementId;
      /** Zero-based face index in the element's canonical topology. */
      readonly faceIndex: number;
    }
  | {
      /** Node-occurrence interaction target. */
      readonly kind: "node";
      /** Stable expanded part-occurrence identifier. */
      readonly partOccurrenceId: PartOccurrenceId;
      /** Stable authored node identifier. */
      readonly nodeId: NodeId;
    }
  | {
      /** Authored-edge occurrence interaction target. */
      readonly kind: "edge";
      /** Stable expanded part-occurrence identifier. */
      readonly partOccurrenceId: PartOccurrenceId;
      /** Canonical authored edge key. */
      readonly key: EdgeKey;
    };

/**
 * The interaction-target variant produced for one requested granularity.
 *
 * Use this when a host abstraction carries the granularity as a generic type;
 * ordinary calls to picking helpers infer it automatically.
 * @category Interaction and picking
 */
export type InteractionTargetFor<K extends InteractionTarget["kind"]> = Extract<
  InteractionTarget,
  {
    /** Target discriminator matching the requested granularity. */
    readonly kind: K;
  }
>;
