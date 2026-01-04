/**
 * Member domain module exports
 *
 * IMPORTANT: This barrel export only includes types.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './member.service' in server-only code
 * (server functions, API routes, etc.)
 */

// Types (no DB dependency)
export type { MemberError, TeamMember } from './member.types'
