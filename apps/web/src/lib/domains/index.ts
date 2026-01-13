/**
 * Domains module exports
 *
 * IMPORTANT: This barrel export only includes types.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './domains.service' in server-only code
 * (server functions, API routes, etc.)
 */

// Types (no DB dependency)
export type {
  Domain,
  DomainType,
  DomainStatus,
  DomainDisplayStatus,
  SslStatus,
  OwnershipStatus,
  AddDomainInput,
  VerificationRecords,
} from './domains.types'

// Helper functions (no DB dependency)
export { getDisplayStatus } from './domains.types'
