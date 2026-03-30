import type { TypeId, PrincipalId } from '@quackback/ids'

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
}

export interface CreateApiKeyInput {
  name: string
  expiresAt?: Date | null
}

export interface CreateApiKeyResult {
  apiKey: ApiKey
  /** The full API key - only returned on creation, never stored */
  plainTextKey: string
}
