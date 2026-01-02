/**
 * User domain module exports
 *
 * IMPORTANT: This barrel export only includes types and error classes.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './user.service' in server-only code
 * (server functions, API routes, etc.)
 */

// Error classes (no DB dependency)
export { UserError } from './user.errors'
export type { UserErrorCode } from './user.errors'

// Types (no DB dependency)
export type {
  PortalUserListItem,
  PortalUserListItemView,
  PortalUserListParams,
  PortalUserListResult,
  PortalUserListResultView,
  PortalUserDetail,
  EngagedPost,
  EngagementType,
} from './user.types'
