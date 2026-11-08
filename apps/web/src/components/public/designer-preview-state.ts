/**
 * What the builder asks the page it designs to show as visitors rarely see
 * it, so its words can be edited where they sit: the feed with no posts, and
 * the feed's composer open on its button. Kept outside React, one value per
 * window: the builder holds what its panel asks for and sends it to the
 * frame, which draws it. Never set outside the builder. Plain, so the
 * designer's side of the frame can import it; React reads it through
 * useDesignerPreview in preview-draft-context.
 */
export interface DesignerPreviewState {
  /** The feed drawn as it is with no posts, showing its empty title. */
  empty: boolean
  /** The feed's composer drawn open, showing its button. */
  composer: boolean
}

/** The message the builder sends the frame with what it asks for. */
export const PREVIEW_STATE_MESSAGE = 'quackback:preview-state'
/** The frame's ask for it, once it listens: the builder answers with PREVIEW_STATE_MESSAGE. */
export const PREVIEW_STATE_ASK = 'quackback:preview-state-ask'

const NONE: DesignerPreviewState = { empty: false, composer: false }
let state = NONE
const listeners = new Set<() => void>()

/** Changes what is asked for; only what is named changes. */
export function setDesignerPreview(next: Partial<DesignerPreviewState>): void {
  const merged = { ...state, ...next }
  if (merged.empty === state.empty && merged.composer === state.composer) return
  state = merged
  for (const listener of listeners) listener()
}

export function designerPreview(): DesignerPreviewState {
  return state
}

export function subscribeDesignerPreview(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Nothing asked for: what the server draws. */
export const NO_PREVIEW_STATE = NONE

/** A message from the builder with what it asks for, or null for any other. */
export function readPreviewState(message: unknown): Partial<DesignerPreviewState> | null {
  const data = message as { type?: unknown; empty?: unknown; composer?: unknown } | null
  if (data?.type !== PREVIEW_STATE_MESSAGE) return null
  const read: Partial<DesignerPreviewState> = {}
  if (typeof data.empty === 'boolean') read.empty = data.empty
  if (typeof data.composer === 'boolean') read.composer = data.composer
  return read
}
