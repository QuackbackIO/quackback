/**
 * The designer's canvas frame never changes anything: no vote, post,
 * comment, upload, sign-in or setting is sent from it, whichever view it
 * draws and whatever is clicked in Preview. The frame's own guard stops the
 * page acting first (`guardWrites`); these refuse what gets past it.
 *
 * - Every server function call a framed designer page makes carries the
 *   frame header (see designer-frame.ts in shared/design), and one that
 *   changes something (POST) is refused.
 * - Any other request that changes something and comes from a designer page,
 *   as its Referer says, is refused before it reaches a route.
 */
import { createMiddleware } from '@tanstack/react-start'
import { thisDesignerFrame } from '@/lib/client/designer-frame'
import {
  DESIGNER_FRAME_HEADER,
  designerFrameHeaders,
  isDesignerSearch,
} from '@/lib/shared/design/designer-frame'

/** The refusal, worded as a denial so it is not logged as a fault. */
export const FRAME_WRITE_REFUSED = "Access denied: the designer's preview sends nothing"

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Whether a server function call is a write from the designer's frame. */
export function refusesFrameCall(method: string, headers: Headers): boolean {
  return !READS.has(method.toUpperCase()) && headers.get(DESIGNER_FRAME_HEADER) === '1'
}

/** Whether a request is a write made by a designer page of this origin. */
export function refusesFrameRequest(request: Request): boolean {
  if (READS.has(request.method.toUpperCase())) return false
  if (request.headers.get(DESIGNER_FRAME_HEADER) === '1') return true
  const referer = request.headers.get('referer')
  if (!referer) return false
  try {
    const from = new URL(referer)
    return from.origin === new URL(request.url).origin && isDesignerSearch(from.searchParams)
  } catch {
    return false
  }
}

export const designerFrameCallMiddleware = createMiddleware({ type: 'function' })
  .client(({ next }) => next({ headers: designerFrameHeaders(thisDesignerFrame()) }))
  .server(async ({ next, method }) => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    if (refusesFrameCall(method, getRequestHeaders())) throw new Error(FRAME_WRITE_REFUSED)
    return next()
  })

export const designerFrameRequestMiddleware = createMiddleware().server(({ next, request }) =>
  refusesFrameRequest(request)
    ? Response.json({ error: FRAME_WRITE_REFUSED }, { status: 403 })
    : next()
)
