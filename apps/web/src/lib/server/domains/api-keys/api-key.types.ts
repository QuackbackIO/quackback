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
  scopes: string[]
  allowedTeamIds: string[]
  allowedInboxIds: string[]
  lastIp: string | null
  lastUserAgent: string | null
  rotatedAt: Date | null
  compatLegacyFullAccess: boolean
  compatAcknowledgedAt: Date | null
}

export interface CreateApiKeyInput {
  name: string
  expiresAt?: Date | null
  scopes?: string[]
  allowedTeamIds?: string[]
  allowedInboxIds?: string[]
}

export interface UpdateApiKeyInput {
  name?: string
  scopes?: string[]
  allowedTeamIds?: string[]
  allowedInboxIds?: string[]
}

export interface CreateApiKeyResult {
  apiKey: ApiKey
  /** The full API key - only returned on creation, never stored */
  plainTextKey: string
}
