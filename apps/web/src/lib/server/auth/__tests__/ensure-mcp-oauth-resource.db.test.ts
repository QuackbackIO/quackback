/**
 * The MCP resource row on real Postgres, rolled back after each test.
 *
 * Better Auth intersects every token's scopes with this row's `allowedScopes`,
 * so the row has to follow the scope vocabulary as it grows.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { oauthResource } from '@/lib/server/db'
import { ensureMcpOauthResource } from '@/lib/server/auth/ensure-mcp-oauth-resource'

const fixture = await createDbTestFixture()
const IDENTIFIER = 'https://acme.example.com/api/mcp'

function ensure(allowedScopes: readonly string[]) {
  return ensureMcpOauthResource({
    db: testDb as unknown as Parameters<typeof ensureMcpOauthResource>[0]['db'],
    table: oauthResource,
    identifier: IDENTIFIER,
    allowedScopes,
  })
}

async function stored() {
  const rows = await testDb
    .select()
    .from(oauthResource)
    .where(eq(oauthResource.identifier, IDENTIFIER))
  expect(rows).toHaveLength(1)
  return rows[0]
}

describe.skipIf(!fixture.available)('MCP resource row (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('adds scopes the vocabulary gained since the row was first seeded', async () => {
    await ensure(['read:feedback', 'write:feedback'])
    const before = await stored()

    await ensure(['read:feedback', 'write:feedback', 'read:settings', 'write:settings'])
    const after = await stored()

    expect(after.id).toBe(before.id)
    expect(after.allowedScopes).toEqual([
      'read:feedback',
      'write:feedback',
      'read:settings',
      'write:settings',
    ])
  })

  it('leaves a row that already matches untouched', async () => {
    await ensure(['read:feedback', 'write:feedback'])
    const before = await stored()

    await ensure(['read:feedback', 'write:feedback'])
    const after = await stored()

    expect(after.updatedAt).toEqual(before.updatedAt)
  })
})
