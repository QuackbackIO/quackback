/**
 * SCIM 2.0 Request Handlers
 *
 * Implements SCIM protocol handlers for user/group provisioning.
 */

import type { SCIMUser, SCIMGroup } from './schemas'

export interface SCIMConfig {
  /** Base URL for SCIM endpoints (e.g., https://app.example.com/scim/v2) */
  baseUrl: string
  /** Bearer token for SCIM authentication */
  bearerToken: string
  /** Optional: custom user attribute mappings */
  userMappings?: UserAttributeMapping
}

export interface UserAttributeMapping {
  /** Map SCIM userName to internal field */
  userName?: string
  /** Map SCIM email to internal field */
  email?: string
  /** Map SCIM displayName to internal field */
  displayName?: string
}

export interface SCIMHandlers {
  users: {
    list: () => Promise<SCIMUser[]>
    get: (id: string) => Promise<SCIMUser | null>
    create: (user: SCIMUser) => Promise<SCIMUser>
    update: (id: string, user: Partial<SCIMUser>) => Promise<SCIMUser>
    delete: (id: string) => Promise<void>
  }
  groups: {
    list: () => Promise<SCIMGroup[]>
    get: (id: string) => Promise<SCIMGroup | null>
    create: (group: SCIMGroup) => Promise<SCIMGroup>
    update: (id: string, group: Partial<SCIMGroup>) => Promise<SCIMGroup>
    delete: (id: string) => Promise<void>
  }
}

/**
 * Create SCIM handlers for the application
 *
 * @example
 * ```ts
 * const handlers = createSCIMHandlers({
 *   baseUrl: 'https://app.example.com/scim/v2',
 *   bearerToken: process.env.SCIM_TOKEN!,
 * })
 *
 * // In your API route:
 * app.get('/scim/v2/Users', async (req, res) => {
 *   const users = await handlers.users.list()
 *   res.json({ Resources: users, totalResults: users.length })
 * })
 * ```
 */
export function createSCIMHandlers(_config: SCIMConfig): SCIMHandlers {
  // TODO: Implement SCIM handlers
  // These will integrate with the member/user repositories
  throw new Error('SCIM handlers not yet implemented')
}
