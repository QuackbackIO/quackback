/**
 * The designer's signed-out view: its canvas frame asks to see the portal as
 * a visitor who is not signed in, and for someone who may change the
 * portal's branding, the request is answered as exactly that.
 *
 * The ask comes from the frame alone: its own document load, an iframe whose
 * address says `designer=1&visitor=out`, or a server function call it makes,
 * which carries the preview header. Anyone else who asks, or asks from
 * anywhere else, is answered as who they are. The answer only ever takes
 * away: the viewer becomes nobody, never someone.
 */
import { PREVIEW_VISITOR_HEADER, isSignedOutSearch } from '@/lib/shared/design/designer-frame'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { SessionScope } from '@/lib/shared/roles'

/** The parts of a request the ask is read from. */
export interface AskingRequest {
  headers: Headers
  /** The request's address, read only for a framed document load. */
  url: () => string
}

/** Whether a request comes from the designer's frame asking to be drawn signed out. */
export function asksSignedOut(request: AskingRequest): boolean {
  if (request.headers.get(PREVIEW_VISITOR_HEADER) === 'out') return true
  // A document load: only one drawn inside a frame.
  if (request.headers.get('sec-fetch-dest') !== 'iframe') return false
  try {
    return isSignedOutSearch(new URL(request.url()).searchParams)
  } catch {
    return false
  }
}

/** Whether someone may see the portal signed out in the designer: they may change its branding. */
export function maySeeSignedOut(
  principalType: string,
  scope: SessionScope,
  permissions: ReadonlySet<PermissionKey>
): boolean {
  return (
    principalType === 'user' &&
    scope === 'dashboard' &&
    permissions.has(PERMISSIONS.SETTINGS_BRANDING)
  )
}
