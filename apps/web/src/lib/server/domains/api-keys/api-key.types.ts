import type { TypeId, PrincipalId } from '@quackback/ids'
import type { ApiKeyScope } from './api-key-scopes'

export type ApiKeyId = TypeId<'api_key'>

export interface ApiKey {
  id: ApiKeyId
  name: string
  keyPrefix: string
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
}

export interface CreateApiKeyResult {
  apiKey: ApiKey
  /** The full API key - only returned on creation, never stored */
  plainTextKey: string
}
