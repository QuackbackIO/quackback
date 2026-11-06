import type { TypeId, PrincipalId, RoleId } from '@quackback/ids'
import type { ApiKeyScope } from './api-key-scopes'
import type { PermissionKey } from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'

export type ApiKeyId = TypeId<'api_key'>

/**
 * A personal key acts as its creator and stops working when they leave. A
 * workspace key has its own role and belongs to nobody.
 */
export type ApiKeyKind = 'personal' | 'workspace'

export interface ApiKey {
  id: ApiKeyId
  name: string
  kind: ApiKeyKind
  keyPrefix: string
  /** Who made the key. For a workspace key this is an audit record only. */
  createdById: PrincipalId | null
  principalId: PrincipalId
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  revokedAt: Date | null
  /**
   * Effective capability scopes, parsed from storage. Null means a legacy
   * full-authority key (created before scope selection); enforcement treats
   * null as every scope.
   */
  scopes: ApiKeyScope[] | null
}

export interface CreateApiKeyInput {
  name: string
  expiresAt?: Date | null
  /** Scopes to grant the key. Omitted/null stores a legacy full-authority key. */
  scopes?: readonly ApiKeyScope[] | null
  /** Defaults to 'personal'. */
  kind?: ApiKeyKind
  /** Required for a workspace key: the workspace role it holds. */
  roleId?: RoleId
}

/** The creator's own authority, the ceiling on the role a workspace key may be given. */
export interface ApiKeyGranter {
  permissions: readonly PermissionKey[]
  role: Role | null
}

export interface CreateApiKeyResult {
  apiKey: ApiKey
  /** The full API key - only returned on creation, never stored */
  plainTextKey: string
}
