/**
 * Byte stride of one sparse emphasis record. The layout mirrors the
 * `ElementHighlight` shader struct: four pick keys, a `vec4<f32>` color, one
 * emissive float, and three flags.
 */
export const ELEMENT_RECORD_STRIDE = 48;

/** Byte offset of sparse and dense highlight payloads after the fixed header. */
export const HIGHLIGHT_HEADER = 64;

/** Initial sparse emphasis record capacity allocated per part. */
export const INITIAL_ELEMENT_HIGHLIGHTS = 128;
