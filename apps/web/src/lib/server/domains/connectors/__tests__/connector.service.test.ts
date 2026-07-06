/**
 * Real-DB coverage for connector CRUD: defaults, HTTPS/slug/timeout/auth
 * validation, the write-only secret contract, and list/enabled filtering.
 * Runs inside the db-test-fixture rollback transaction. Execution
 * (executeConnector/testConnector) is covered separately in
 * connector.service.execute.test.ts, where the network and rate-limit
 * dependencies are mocked instead.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { dataConnectors } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// One fake entry so the static-tool-collision guard has something to trip on,
// without depending on the real (large) assistant tool-catalogue import graph.
vi.mock('@/lib/server/domains/assistant/assistant.toolspec', () => ({
  ASSISTANT_TOOL_SPECS: { connector_taken_name: {} },
}))

// Real encryption needs a configured SECRET_KEY this test environment doesn't
// set up; deterministic stand-ins are enough to exercise the write-only
// contract (a value goes in encrypted, hasSecret flips, the plaintext never
// comes back out) without depending on real crypto config.
vi.mock('../connector.encryption', () => ({
  encryptConnectorSecret: (secret: string) => `enc:${secret}`,
  decryptConnectorSecret: (ciphertext: string) => ciphertext.replace(/^enc:/, ''),
}))

import {
  createConnector,
  updateConnector,
  deleteConnector,
  getConnector,
  listConnectors,
  listEnabledConnectors,
  toAuditSafeConnector,
} from '../connector.service'
import type { DataConnector } from '../connector.types'
import type { DataConnectorId } from '@quackback/ids'

const fixture = await createDbTestFixture({
  probe: async (db) =>
    void (await db.select({ id: dataConnectors.id }).from(dataConnectors).limit(0)),
})

describe.skipIf(!fixture.available)('connector.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('createConnector', () => {
    it('creates with sensible defaults and a derived snake_case slug', async () => {
      const created = await createConnector(
        {
          name: 'Get User',
          description: 'Look up a user by id.',
          method: 'GET',
          urlTemplate: 'https://api.example.com/users/{id}',
        },
        null
      )
      expect(created.slug).toBe('get_user')
      expect(created.enabled).toBe(false)
      expect(created.status).toBe('active')
      expect(created.timeoutMs).toBe(10000)
      expect(created.hasSecret).toBe(false)
      expect(created.failureCount).toBe(0)
      expect(created.headers).toEqual([])
      expect(created.auth).toEqual({ type: 'none' })
    })

    it('never leaks the secret into the create response or a later read', async () => {
      const created = await createConnector(
        {
          name: 'Billing Lookup',
          description: 'Look up a billing account.',
          method: 'GET',
          urlTemplate: 'https://api.example.com/billing/{id}',
          auth: { type: 'bearer' },
          secret: 'sk_super_secret_value',
        },
        null
      )
      expect(created.hasSecret).toBe(true)
      expect(JSON.stringify(created)).not.toContain('sk_super_secret_value')
      expect(created).not.toHaveProperty('secretCiphertext')
      expect(created).not.toHaveProperty('secret')

      const fetched = await getConnector(created.id)
      expect(fetched.hasSecret).toBe(true)
      expect(JSON.stringify(fetched)).not.toContain('sk_super_secret_value')

      const listed = await listConnectors()
      expect(JSON.stringify(listed)).not.toContain('sk_super_secret_value')
    })

    it('rejects a non-HTTPS url template', async () => {
      await expect(
        createConnector(
          {
            name: 'Insecure',
            description: 'x',
            method: 'GET',
            urlTemplate: 'http://api.example.com/x',
          },
          null
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects a malformed url template', async () => {
      await expect(
        createConnector(
          { name: 'Malformed', description: 'x', method: 'GET', urlTemplate: 'https://' },
          null
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects a duplicate connector name', async () => {
      await createConnector(
        {
          name: 'Duplicate',
          description: 'x',
          method: 'GET',
          urlTemplate: 'https://api.example.com/a',
        },
        null
      )
      await expect(
        createConnector(
          {
            name: 'Duplicate',
            description: 'y',
            method: 'GET',
            urlTemplate: 'https://api.example.com/b',
          },
          null
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects two different names that derive the same slug', async () => {
      await createConnector(
        {
          name: 'Get  User!!',
          description: 'x',
          method: 'GET',
          urlTemplate: 'https://api.example.com/a',
        },
        null
      )
      await expect(
        createConnector(
          {
            name: 'get user',
            description: 'y',
            method: 'GET',
            urlTemplate: 'https://api.example.com/b',
          },
          null
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects a slug that collides with a static assistant tool name', async () => {
      await expect(
        createConnector(
          {
            name: 'Taken Name',
            description: 'x',
            method: 'GET',
            urlTemplate: 'https://api.example.com/a',
          },
          null
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects a timeout above the 30s cap', async () => {
      await expect(
        createConnector(
          {
            name: 'Slow',
            description: 'x',
            method: 'GET',
            urlTemplate: 'https://api.example.com/a',
            timeoutMs: 30001,
          },
          null
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects a bearer auth type with no secret', async () => {
      await expect(
        createConnector(
          {
            name: 'No Secret',
            description: 'x',
            method: 'GET',
            urlTemplate: 'https://api.example.com/a',
            auth: { type: 'bearer' },
          },
          null
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects a header auth type with no headerName', async () => {
      await expect(
        createConnector(
          {
            name: 'No Header Name',
            description: 'x',
            method: 'GET',
            urlTemplate: 'https://api.example.com/a',
            auth: { type: 'header' },
            secret: 'x',
          },
          null
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects an invalid input field name', async () => {
      await expect(
        createConnector(
          {
            name: 'Bad Input',
            description: 'x',
            method: 'GET',
            urlTemplate: 'https://api.example.com/a',
            inputs: [{ name: '1bad', type: 'string' }],
          },
          null
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects duplicate input field names', async () => {
      await expect(
        createConnector(
          {
            name: 'Dup Input',
            description: 'x',
            method: 'GET',
            urlTemplate: 'https://api.example.com/a',
            inputs: [
              { name: 'id', type: 'string' },
              { name: 'id', type: 'number' },
            ],
          },
          null
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })
  })

  describe('updateConnector', () => {
    it('re-derives the slug when the name changes', async () => {
      const created = await createConnector(
        {
          name: 'Old Name',
          description: 'x',
          method: 'GET',
          urlTemplate: 'https://api.example.com/a',
        },
        null
      )
      const updated = await updateConnector(created.id, { name: 'New Name' })
      expect(updated.slug).toBe('new_name')
    })

    it('accepts a new secret and reports hasSecret without exposing it', async () => {
      const created = await createConnector(
        {
          name: 'Secretless',
          description: 'x',
          method: 'GET',
          urlTemplate: 'https://api.example.com/a',
        },
        null
      )
      expect(created.hasSecret).toBe(false)
      const updated = await updateConnector(created.id, {
        auth: { type: 'bearer' },
        secret: 'sk_new_value',
      })
      expect(updated.hasSecret).toBe(true)
      expect(JSON.stringify(updated)).not.toContain('sk_new_value')
    })

    it('clears the secret via clearSecret, then rejects a non-none auth type', async () => {
      const created = await createConnector(
        {
          name: 'Has Secret',
          description: 'x',
          method: 'GET',
          urlTemplate: 'https://api.example.com/a',
          auth: { type: 'bearer' },
          secret: 'sk_value',
        },
        null
      )
      const cleared = await updateConnector(created.id, {
        clearSecret: true,
        auth: { type: 'none' },
      })
      expect(cleared.hasSecret).toBe(false)

      await expect(updateConnector(created.id, { auth: { type: 'bearer' } })).rejects.toMatchObject(
        {
          code: 'VALIDATION_ERROR',
        }
      )
    })

    it('re-enabling from disabled resets the circuit breaker', async () => {
      const created = await createConnector(
        {
          name: 'Breaker',
          description: 'x',
          method: 'GET',
          urlTemplate: 'https://api.example.com/a',
        },
        null
      )
      // Simulate a tripped breaker directly (executeConnector's own increment
      // path is covered in connector.service.execute.test.ts) so this test
      // exercises the reset, not just a no-op default.
      await testDb
        .update(dataConnectors)
        .set({ status: 'disabled', failureCount: 50, lastError: 'boom' })
        .where(eq(dataConnectors.id, created.id))

      const reenabled = await updateConnector(created.id, { status: 'active' })
      expect(reenabled.status).toBe('active')
      expect(reenabled.failureCount).toBe(0)
      expect(reenabled.lastError).toBeNull()
    })
  })

  describe('deleteConnector', () => {
    it('removes the row; a later read 404s', async () => {
      const created = await createConnector(
        {
          name: 'Doomed',
          description: 'x',
          method: 'GET',
          urlTemplate: 'https://api.example.com/a',
        },
        null
      )
      await deleteConnector(created.id)
      await expect(getConnector(created.id)).rejects.toMatchObject({ code: 'CONNECTOR_NOT_FOUND' })
    })
  })

  describe('listEnabledConnectors', () => {
    it('excludes disabled and circuit-broken connectors', async () => {
      const enabled = await createConnector(
        {
          name: 'Enabled One',
          description: 'x',
          method: 'GET',
          urlTemplate: 'https://api.example.com/a',
          enabled: true,
        },
        null
      )
      await createConnector(
        {
          name: 'Never Enabled',
          description: 'x',
          method: 'GET',
          urlTemplate: 'https://api.example.com/b',
          enabled: false,
        },
        null
      )
      const brokenCreated = await createConnector(
        {
          name: 'Broken',
          description: 'x',
          method: 'GET',
          urlTemplate: 'https://api.example.com/c',
          enabled: true,
        },
        null
      )
      await updateConnector(brokenCreated.id, { status: 'disabled' })

      const enabledList = await listEnabledConnectors()
      expect(enabledList.map((c) => c.id)).toEqual([enabled.id])
    })
  })
})

// Pure function — no DB needed, so this runs regardless of fixture availability.
describe('toAuditSafeConnector', () => {
  it('keeps only name, method, and enabled — never headers, auth, or the secret flag', () => {
    const connector: DataConnector = {
      id: 'data_connector_1' as DataConnectorId,
      name: 'Billing Lookup',
      slug: 'billing_lookup',
      description: 'Look up a billing account.',
      method: 'GET',
      urlTemplate: 'https://api.example.com/billing/{id}',
      headers: [{ name: 'X-Api-Key', value: 'super-secret' }],
      auth: { type: 'bearer' },
      hasSecret: true,
      inputs: [],
      bodyTemplate: null,
      exampleResponse: null,
      responsePaths: null,
      timeoutMs: 10000,
      enabled: true,
      status: 'active',
      failureCount: 0,
      lastError: null,
      lastTestedAt: null,
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const safe = toAuditSafeConnector(connector)

    expect(safe).toEqual({ name: 'Billing Lookup', method: 'GET', enabled: true })
    expect(safe).not.toHaveProperty('headers')
    expect(safe).not.toHaveProperty('auth')
    expect(safe).not.toHaveProperty('hasSecret')
  })
})
