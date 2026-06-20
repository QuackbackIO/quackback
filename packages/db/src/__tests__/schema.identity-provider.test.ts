import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { identityProvider, ssoVerifiedDomain } from '../schema/auth'

describe('identity_provider schema', () => {
  it('has the expected table name', () => {
    expect(getTableName(identityProvider)).toBe('identity_provider')
  })

  it('exposes the expected columns', () => {
    const cols = Object.keys(getTableColumns(identityProvider))
    for (const c of [
      'id',
      'registrationId',
      'label',
      'discoveryUrl',
      'authorizationUrl',
      'tokenUrl',
      'userInfoUrl',
      'clientId',
      'scopes',
      'enabled',
      'autoCreateUsers',
      'autoProvisionRole',
      'attributeMapping',
      'showButton',
      'detailsChangedAt',
      'lastSuccessfulTestAt',
      'createdAt',
    ]) {
      expect(cols).toContain(c)
    }
  })

  it('id is a uuid-typed TypeID column', () => {
    // PgCustomColumn reports dataType 'custom'; the SQL storage type is uuid.
    expect(getTableColumns(identityProvider).id.getSQLType()).toBe('uuid')
  })

  it('enforces NOT NULL / nullable on the load-bearing columns', () => {
    const cols = getTableColumns(identityProvider)
    expect(cols.registrationId.notNull).toBe(true)
    expect(cols.label.notNull).toBe(true)
    expect(cols.clientId.notNull).toBe(true)
    expect(cols.enabled.notNull).toBe(true)
    expect(cols.autoCreateUsers.notNull).toBe(true)
    expect(cols.showButton.notNull).toBe(true)
    expect(cols.createdAt.notNull).toBe(true)
    // Manual-endpoint installs have no discovery doc; these stay nullable.
    expect(cols.discoveryUrl.notNull).toBe(false)
    expect(cols.scopes.notNull).toBe(false)
    expect(cols.attributeMapping.notNull).toBe(false)
  })

  it('domains reference a provider via a nullable uuid TypeID FK', () => {
    const cols = getTableColumns(ssoVerifiedDomain)
    expect(Object.keys(cols)).toContain('providerId')
    expect(cols.providerId.getSQLType()).toBe('uuid')
    // Nullable during migration: existing domains are unlinked until backfill.
    expect(cols.providerId.notNull).toBe(false)
  })
})
