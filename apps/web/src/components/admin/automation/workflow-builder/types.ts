import type { StepLocation } from '../workflow-graph'

/**
 * What the inspector panel currently shows: a step (including the trigger) to
 * edit, an insertion point to fill from the step palette, or nothing (empty
 * state). Selection lives above the canvas so the outline rail, the "+"
 * connectors, and the inspector all read/write the same value.
 */
export type BuilderSelection =
  | { kind: 'node'; id: string }
  | { kind: 'insert'; location: StepLocation; index: number }
  | null
