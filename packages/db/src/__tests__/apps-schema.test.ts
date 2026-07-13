import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { apps } from '../schema/apps'

/** WO-12 — the third-party app platform table shape. */
describe('apps schema', () => {
  it('has the correct table name', () => {
    expect(getTableName(apps)).toBe('apps')
  })

  it('exposes the app-platform columns', () => {
    const columns = Object.keys(getTableColumns(apps))
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'oauthClientId',
        'name',
        'grantedScopes',
        'webhookEndpoint',
        'webhookSecretEnc',
        'subscribedEventTypes',
        'status',
        'createdAt',
        'updatedAt',
      ])
    )
  })

  it('requires id, oauthClientId, name, scopes, subscriptions, status', () => {
    const cols = getTableColumns(apps)
    for (const key of [
      'id',
      'oauthClientId',
      'name',
      'grantedScopes',
      'subscribedEventTypes',
      'status',
    ] as const) {
      expect(cols[key].notNull, key).toBe(true)
    }
    // webhook endpoint + secret are nullable (an app may not use webhooks).
    expect(cols.webhookEndpoint.notNull).toBe(false)
    expect(cols.webhookSecretEnc.notNull).toBe(false)
  })

  it('cascades app deletion from its OAuth client', () => {
    const config = getTableConfig(apps)
    const oauthClientFk = config.foreignKeys.find((foreignKey) => {
      const reference = foreignKey.reference()
      return getTableName(reference.foreignTable) === 'oauth_client'
    })
    expect(oauthClientFk).toBeDefined()
    expect(oauthClientFk?.onDelete).toBe('cascade')
  })
})
