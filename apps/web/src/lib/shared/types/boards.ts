/**
 * Board-related types for client use.
 *
 * Re-exported from the server domain for architectural compliance — type-only
 * imports are erased at compile time and never affect the bundle.
 */

import type { BoardWithStats } from '@/lib/server/domains/boards'

export type { BoardWithStats }

/**
 * A board as exposed to public/portal clients: the internal `access` matrix
 * (segment ids, per-action tiers, moderation rules) is stripped before
 * serialization — clients gate via the server-computed boardPermissions /
 * boardCapabilitiesForActor and never read `access` (#191).
 */
export type PublicBoardWithStats = Omit<BoardWithStats, 'access' | 'readOnly'>

/**
 * What the current viewer can do on one board, computed on the server.
 * `readOnly` marks a board that shows its posts and takes no new posts, votes
 * or comments; `shareBoardId` is a board to post to instead, when one exists.
 * Neither names a plan.
 */
export interface BoardPermission {
  canSubmit: boolean
  canVote: boolean
  readOnly?: boolean
  shareBoardId?: string | null
}
