/**
 * Tests for the Phase 6 API key scope assertion helpers.
 */
import { describe, it, expect } from 'vitest'
import {
  assertScopeAllowed,
  assertTeamAllowed,
  assertInboxAllowed,
  type ApiAuthContext,
} from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/server/domains/authz/authz.permissions'
import { ForbiddenError } from '@/lib/shared/errors'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import type { ApiKeyId, PrincipalId } from '@quackback/ids'

function makeCtx(overrides: Partial<ApiAuthContext['key']> = {}): ApiAuthContext {
  const baseKey: ApiKey = {
    id: 'apikey_01h455vb4pex5vsknk084sn02q' as ApiKeyId,
    name: 'k',
    keyPrefix: 'qb_t',
    createdById: null,
    principalId: 'principal_01h455vb4pex5vsknk084sn02s' as PrincipalId,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    revokedAt: null,
    scopes: overrides.scopes ?? [],
    allowedTeamIds: overrides.allowedTeamIds ?? [],
    allowedInboxIds: overrides.allowedInboxIds ?? [],
    lastIp: null,
    lastUserAgent: null,
    rotatedAt: null,
    compatLegacyFullAccess: overrides.compatLegacyFullAccess ?? true,
    compatAcknowledgedAt: null,
  }
  return {
    apiKey: baseKey,
    principalId: baseKey.principalId,
    role: 'member',
    importMode: false,
    ipAddress: null,
    userAgent: null,
    source: 'api',
    key: {
      id: baseKey.id,
      name: baseKey.name,
      scopes: baseKey.scopes,
      allowedTeamIds: baseKey.allowedTeamIds,
      allowedInboxIds: baseKey.allowedInboxIds,
      compatLegacyFullAccess: baseKey.compatLegacyFullAccess,
    },
  }
}

describe('assertScopeAllowed', () => {
  it('allows any permission when scopes empty + legacy compat true', () => {
    const ctx = makeCtx({ scopes: [], compatLegacyFullAccess: true })
    expect(() => assertScopeAllowed(ctx, PERMISSIONS.TICKET_VIEW_ALL)).not.toThrow()
    expect(() => assertScopeAllowed(ctx, PERMISSIONS.AUDIT_VIEW)).not.toThrow()
  })

  it('denies when scopes empty + legacy compat false', () => {
    const ctx = makeCtx({ scopes: [], compatLegacyFullAccess: false })
    expect(() => assertScopeAllowed(ctx, PERMISSIONS.TICKET_VIEW_ALL)).toThrow(ForbiddenError)
  })

  it('allows when permission is in scopes', () => {
    const ctx = makeCtx({ scopes: [PERMISSIONS.AUDIT_VIEW], compatLegacyFullAccess: false })
    expect(() => assertScopeAllowed(ctx, PERMISSIONS.AUDIT_VIEW)).not.toThrow()
  })

  it('denies when permission not in scopes (even if compat true)', () => {
    const ctx = makeCtx({ scopes: [PERMISSIONS.AUDIT_VIEW], compatLegacyFullAccess: true })
    expect(() => assertScopeAllowed(ctx, PERMISSIONS.TICKET_VIEW_ALL)).toThrow(ForbiddenError)
  })
})

describe('assertTeamAllowed', () => {
  it('allows when allowedTeamIds is empty', () => {
    const ctx = makeCtx({ allowedTeamIds: [] })
    expect(() => assertTeamAllowed(ctx, 'team_xyz')).not.toThrow()
  })

  it('allows when teamId is null/undefined', () => {
    const ctx = makeCtx({ allowedTeamIds: ['team_abc'] })
    expect(() => assertTeamAllowed(ctx, null)).not.toThrow()
    expect(() => assertTeamAllowed(ctx, undefined)).not.toThrow()
  })

  it('allows when teamId is in allowedTeamIds', () => {
    const ctx = makeCtx({ allowedTeamIds: ['team_abc', 'team_def'] })
    expect(() => assertTeamAllowed(ctx, 'team_abc')).not.toThrow()
  })

  it('denies when teamId is not in allowedTeamIds', () => {
    const ctx = makeCtx({ allowedTeamIds: ['team_abc'] })
    expect(() => assertTeamAllowed(ctx, 'team_xyz')).toThrow(ForbiddenError)
  })
})

describe('assertInboxAllowed', () => {
  it('allows when allowedInboxIds is empty', () => {
    const ctx = makeCtx({ allowedInboxIds: [] })
    expect(() => assertInboxAllowed(ctx, 'inbox_xyz')).not.toThrow()
  })

  it('denies when inboxId is not in allowedInboxIds', () => {
    const ctx = makeCtx({ allowedInboxIds: ['inbox_abc'] })
    expect(() => assertInboxAllowed(ctx, 'inbox_xyz')).toThrow(ForbiddenError)
  })

  it('allows when inboxId is in allowedInboxIds', () => {
    const ctx = makeCtx({ allowedInboxIds: ['inbox_abc'] })
    expect(() => assertInboxAllowed(ctx, 'inbox_abc')).not.toThrow()
  })
})
