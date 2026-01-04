/**
 * Stub for @quackback/ee-scim
 *
 * This module is used when INCLUDE_EE=false to enable tree-shaking.
 * It provides the same exports as the real package but with no-op implementations.
 */

export interface SCIMConfig {
  baseUrl: string
  bearerToken: string
}

export interface SCIMUser {
  id: string
  userName: string
  emails: Array<{ value: string; primary: boolean }>
  name: { givenName: string; familyName: string }
  active: boolean
}

export interface SCIMGroup {
  id: string
  displayName: string
  members: Array<{ value: string; display: string }>
}

export const SCIMUserSchema = null
export const SCIMGroupSchema = null

export function createSCIMHandlers(_config: SCIMConfig): never {
  throw new Error('SCIM is not available in this edition. Upgrade to Enterprise.')
}

export const SCIM_AVAILABLE = false
