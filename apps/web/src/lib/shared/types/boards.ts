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
export type PublicBoardWithStats = Omit<BoardWithStats, 'access'>
