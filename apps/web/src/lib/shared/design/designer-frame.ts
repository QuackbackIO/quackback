/**
 * The designer's canvas frame, as its address and its requests say so.
 *
 * The canvas loads a portal page with `designer=1`, and with `visitor=out`
 * to draw it as a signed-out visitor sees it. Requests the framed page makes
 * carry headers naming both, so the server can refuse a write from the frame
 * and, for someone who may change the portal's branding, answer as nobody
 * signed in. Both only ever take something away: a page that asks for less
 * than its viewer may see, or a write that is not sent.
 */

/** Set on every server function call a designer frame makes. */
export const DESIGNER_FRAME_HEADER = 'x-qb-designer-frame'
/** Set, with `out`, when the frame draws the portal for a signed-out visitor. */
export const PREVIEW_VISITOR_HEADER = 'x-qb-preview-visitor'

/** Who the canvas draws the portal for. */
export type CanvasVisitor = 'in' | 'out'

/** Whether a search is the designer frame's own. */
export function isDesignerSearch(search: URLSearchParams): boolean {
  return search.get('designer') === '1'
}

/** Whether a search is the designer frame drawing for a signed-out visitor. */
export function isSignedOutSearch(search: URLSearchParams): boolean {
  return isDesignerSearch(search) && search.get('visitor') === 'out'
}

/** What a framed designer page is drawn as, from its first address, or null for any other page. */
export function designerFrameOf(view: {
  self: unknown
  top: unknown
  location: { search: string }
}): { visitor: CanvasVisitor } | null {
  if (view.self === view.top) return null
  const search = new URLSearchParams(view.location.search)
  if (!isDesignerSearch(search)) return null
  return { visitor: isSignedOutSearch(search) ? 'out' : 'in' }
}

/** The headers a framed designer page's requests carry. */
export function designerFrameHeaders(
  frame: { visitor: CanvasVisitor } | null
): Record<string, string> {
  if (!frame) return {}
  return frame.visitor === 'out'
    ? { [DESIGNER_FRAME_HEADER]: '1', [PREVIEW_VISITOR_HEADER]: 'out' }
    : { [DESIGNER_FRAME_HEADER]: '1' }
}
