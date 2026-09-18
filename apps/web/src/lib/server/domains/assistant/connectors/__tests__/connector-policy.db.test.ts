/**
 * The connection gate, against a real database.
 *
 * These cases exist because the interesting failures are all about state that
 * outlives one function call: a row written before the per-use columns existed,
 * a policy edited in another tab, a tool contract that changed between the
 * proposal and the approval. Each runs inside the fixture's rolled-back
 * transaction, with the module-level `db` rebound to it so the dispatch-time
 * recheck reads the same rows the test wrote.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { connectors } from '@/lib/server/db'
import { eq } from 'drizzle-orm'
import type { CachedConnectorTool } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { getConnector, updateConnector, type ConnectorRow } from '../connectors.service'
import { reviewConnectorTools } from '../connector-review.service'
import {
  getConnectorSpecByToolName,
  listConnectorToolSpecsForAgent,
  resolveConnectorApprovalSpec,
} from '../connector-tools'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({
        id: connectors.id,
        profilePolicies: connectors.profilePolicies,
        toolReviews: connectors.toolReviews,
        catalogRevision: connectors.catalogRevision,
        policyVersion: connectors.policyVersion,
      })
      .from(connectors)
      .limit(0)
  },
})

const READ_TOOL: CachedConnectorTool = {
  name: 'get_invoice',
  annotations: { readOnlyHint: true },
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  firstSeenAt: '2026-01-01T00:00:00.000Z',
}

const WRITE_TOOL: CachedConnectorTool = {
  name: 'issue_refund',
  annotations: {},
  inputSchema: {
    type: 'object',
    properties: { amountCents: { type: 'integer', minimum: 1 } },
    required: ['amountCents'],
  },
  firstSeenAt: '2026-01-01T00:00:00.000Z',
}

let seq = 0

async function insertConnector(
  overrides: Partial<typeof connectors.$inferInsert> = {}
): Promise<ConnectorRow> {
  seq += 1
  const [row] = await testDb
    .insert(connectors)
    .values({
      id: createId('connector'),
      name: `Acme ${seq}`,
      slug: `acme-${seq}`,
      url: 'https://example.test/mcp',
      authMode: 'none',
      status: 'connected',
      tools: [READ_TOOL, WRITE_TOOL],
      assignments: { agent: true, copilot: true },
      ...overrides,
    })
    .returning()
  return row!
}

/** Everything the given use may call on this connector, by bare tool name. */
async function callableTools(profile: 'agent' | 'copilot', slug: string): Promise<string[]> {
  const specs = await listConnectorToolSpecsForAgent(profile, testDb)
  return specs
    .filter((spec) => spec.name.startsWith(`connector_${slug}__`))
    .map((spec) => spec.name.replace(`connector_${slug}__`, ''))
    .sort()
}

async function policyFor(profile: 'agent' | 'copilot', slug: string, tool: string) {
  const specs = await listConnectorToolSpecsForAgent(profile, testDb)
  return specs.find((spec) => spec.name === `connector_${slug}__${tool}`)?.approvalPolicy ?? 'never'
}

describe.skipIf(!fixture.available)('connector policies on a real database', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('lazy projection of the pre-profile shared map', () => {
    it('copies the shared map into the assigned uses only, and persists it once', async () => {
      const inserted = await insertConnector({
        assignments: { agent: true, copilot: false },
        toolPolicies: {
          groupDefaults: { read: 'always', write: 'approval' },
          tools: { issue_refund: 'never' },
        },
        profilePolicies: null,
        toolReviews: null,
      })
      expect(inserted.profilePolicies).toBeNull()

      const migrated = await getConnector(inserted.id, testDb)
      expect(migrated?.profilePolicies?.agent?.groupDefaults).toEqual({
        read: 'always',
        write: 'approval',
      })
      expect(migrated?.profilePolicies?.agent?.tools).toEqual({ issue_refund: 'never' })
      expect(migrated?.profilePolicies?.agent?.origin).toBe('migrated_from_shared')
      expect(migrated?.profilePolicies?.copilot).toBeUndefined()

      const [stored] = await testDb
        .select()
        .from(connectors)
        .where(eq(connectors.id, inserted.id))
        .limit(1)
      expect(stored!.profilePolicies).not.toBeNull()
      expect(stored!.toolReviews).not.toBeNull()
    })

    it('grandfathers the contracts its tools already had, so they stay callable', async () => {
      const row = await insertConnector({ profilePolicies: null, toolReviews: null })
      expect(await callableTools('agent', row.slug)).toEqual(['get_invoice', 'issue_refund'])
    })

    it('leaves an unassigned use denied rather than projecting into it', async () => {
      const row = await insertConnector({
        assignments: { agent: true, copilot: true },
        profilePolicies: null,
        toolReviews: null,
        toolPolicies: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
      })
      // Only `agent` was assigned when the shared map was written, so only
      // `agent` gets a record; `copilot` is assigned but has no policy of its
      // own and must deny rather than borrow.
      await testDb
        .update(connectors)
        .set({
          profilePolicies: {
            agent: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
          },
        })
        .where(eq(connectors.id, row.id))
      expect(await callableTools('agent', row.slug)).toEqual(['get_invoice', 'issue_refund'])
      expect(await callableTools('copilot', row.slug)).toEqual([])
    })
  })

  describe('independent policies per use', () => {
    const MATRIX = ['always', 'approval', 'never'] as const
    for (const customer of MATRIX) {
      for (const teammate of MATRIX) {
        it(`customer ${customer} and teammate ${teammate} resolve independently`, async () => {
          const row = await insertConnector({
            profilePolicies: {
              agent: { groupDefaults: { read: customer, write: customer }, tools: {} },
              copilot: { groupDefaults: { read: teammate, write: teammate }, tools: {} },
            },
            toolReviews: null,
          })
          expect(await policyFor('agent', row.slug, 'issue_refund')).toBe(customer)
          expect(await policyFor('copilot', row.slug, 'issue_refund')).toBe(teammate)
        })
      }
    }

    it('applies a per-tool override to one use without touching the other', async () => {
      const row = await insertConnector({
        profilePolicies: {
          agent: {
            groupDefaults: { read: 'always', write: 'approval' },
            tools: { issue_refund: 'never' },
          },
          copilot: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
        },
        toolReviews: null,
      })
      expect(await callableTools('agent', row.slug)).toEqual(['get_invoice'])
      expect(await callableTools('copilot', row.slug)).toEqual(['get_invoice', 'issue_refund'])
    })

    it('denies every tool for a use with no policy record', async () => {
      const row = await insertConnector({
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
        },
        toolReviews: null,
      })
      expect(await callableTools('copilot', row.slug)).toEqual([])
    })

    it('denies a connector this use is not assigned to', async () => {
      const row = await insertConnector({
        assignments: { agent: true, copilot: false },
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
          copilot: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
        },
        toolReviews: null,
      })
      expect(await callableTools('copilot', row.slug)).toEqual([])
    })
  })

  describe('the reviewed catalog', () => {
    it('makes a newly discovered tool unavailable to both uses until it is reviewed', async () => {
      const row = await insertConnector({
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
          copilot: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
        },
        toolReviews: {},
      })
      expect(await callableTools('agent', row.slug)).toEqual([])
      expect(await callableTools('copilot', row.slug)).toEqual([])

      await reviewConnectorTools(
        row.id,
        { toolNames: ['get_invoice'], expectedCatalogRevision: row.catalogRevision },
        null,
        testDb
      )
      expect(await callableTools('agent', row.slug)).toEqual(['get_invoice'])
      expect(await callableTools('copilot', row.slug)).toEqual(['get_invoice'])
    })

    it('withdraws a tool from both uses when its input schema changes', async () => {
      const row = await insertConnector({
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
          copilot: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
        },
        toolReviews: null,
      })
      expect(await callableTools('agent', row.slug)).toContain('issue_refund')

      await testDb
        .update(connectors)
        .set({
          tools: [
            READ_TOOL,
            { ...WRITE_TOOL, inputSchema: { type: 'object', properties: { note: {} } } },
          ],
        })
        .where(eq(connectors.id, row.id))

      expect(await callableTools('agent', row.slug)).toEqual(['get_invoice'])
      expect(await callableTools('copilot', row.slug)).toEqual(['get_invoice'])
    })

    it('withdraws a tool that flips to a destructive annotation', async () => {
      const row = await insertConnector({
        tools: [READ_TOOL],
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
        },
        toolReviews: null,
      })
      // Read once first: that is what records the contract this connector was
      // already running under, and the flip has to come after it.
      expect(await callableTools('agent', row.slug)).toEqual(['get_invoice'])
      await testDb
        .update(connectors)
        .set({
          tools: [{ ...READ_TOOL, annotations: { readOnlyHint: true, destructiveHint: true } }],
        })
        .where(eq(connectors.id, row.id))
      expect(await callableTools('agent', row.slug)).toEqual([])
    })

    it('refuses a review whose catalog revision has moved', async () => {
      const row = await insertConnector({ toolReviews: {} })
      await expect(
        reviewConnectorTools(
          row.id,
          { toolNames: ['get_invoice'], expectedCatalogRevision: row.catalogRevision + 1 },
          null,
          testDb
        )
      ).rejects.toMatchObject({ code: 'CONNECTOR_CATALOG_CONFLICT' })
    })

    it('makes a tool with an unenforceable input schema unavailable', async () => {
      const row = await insertConnector({
        tools: [
          { ...READ_TOOL, inputSchema: { type: 'object', properties: { a: { $ref: '#/x' } } } },
        ],
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
        },
        toolReviews: null,
      })
      expect(await callableTools('agent', row.slug)).toEqual([])
    })
  })

  describe('stale clients', () => {
    it('accepts a policy write at the current version and bumps it', async () => {
      const row = await insertConnector({
        assignments: { agent: true, copilot: false },
        toolReviews: null,
      })
      const updated = await updateConnector(
        row.id,
        {
          profilePolicies: {
            agent: { groupDefaults: { read: 'always', write: 'never' }, tools: {} },
          },
          expectedPolicyVersion: row.policyVersion,
        },
        testDb
      )
      expect(updated?.policyVersion).toBe(row.policyVersion + 1)
      expect(updated?.profilePolicies?.agent?.groupDefaults.write).toBe('never')
      expect(updated?.profilePolicies?.copilot).toBeUndefined()
    })

    it('refuses a policy write whose base version has moved', async () => {
      const row = await insertConnector({ toolReviews: null })
      await updateConnector(
        row.id,
        {
          profilePolicies: {
            agent: { groupDefaults: { read: 'always', write: 'never' }, tools: {} },
          },
          expectedPolicyVersion: row.policyVersion,
        },
        testDb
      )
      await expect(
        updateConnector(
          row.id,
          {
            profilePolicies: {
              agent: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
            },
            expectedPolicyVersion: row.policyVersion,
          },
          testDb
        )
      ).rejects.toMatchObject({ code: 'CONNECTOR_POLICY_CONFLICT' })

      const current = await getConnector(row.id, testDb)
      expect(current?.profilePolicies?.agent?.groupDefaults.write).toBe('never')
    })

    it('refuses a policy write that carries no base version at all', async () => {
      const row = await insertConnector({ toolReviews: null })
      await expect(
        updateConnector(
          row.id,
          {
            profilePolicies: {
              agent: { groupDefaults: { read: 'always', write: 'always' }, tools: {} },
            },
          },
          testDb
        )
      ).rejects.toMatchObject({ code: 'CONNECTOR_POLICY_VERSION_REQUIRED' })
    })

    it('seeds a policy record when a use is newly assigned, and only then', async () => {
      const row = await insertConnector({
        assignments: { agent: true, copilot: false },
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
        },
        toolReviews: null,
      })
      const updated = await updateConnector(
        row.id,
        { assignments: { agent: true, copilot: true } },
        testDb
      )
      expect(updated?.profilePolicies?.copilot?.groupDefaults).toEqual({
        read: 'always',
        write: 'approval',
      })
      expect(updated?.profilePolicies?.copilot?.origin).toBe('explicit')
      expect(updated?.policyVersion).toBe(row.policyVersion + 1)
    })
  })

  describe('approval re-resolution', () => {
    const proposal = (row: ConnectorRow, profile: 'agent' | 'copilot') => ({
      toolName: `connector_${row.slug}__issue_refund`,
      profile,
      proposedPolicyVersion: row.policyVersion,
    })

    it('resolves the proposing use, not the approver own', async () => {
      const row = await insertConnector({
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
          copilot: {
            groupDefaults: { read: 'always', write: 'approval' },
            tools: { issue_refund: 'never' },
          },
        },
        toolReviews: null,
      })
      const customerOrigin = await resolveConnectorApprovalSpec(proposal(row, 'agent'), testDb)
      expect(customerOrigin.status).toBe('ok')
      const teammateOrigin = await resolveConnectorApprovalSpec(proposal(row, 'copilot'), testDb)
      expect(teammateOrigin).toMatchObject({ status: 'denied' })
    })

    it('denies once the proposing use policy moves to never', async () => {
      const row = await insertConnector({
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
        },
        toolReviews: null,
      })
      expect((await resolveConnectorApprovalSpec(proposal(row, 'agent'), testDb)).status).toBe('ok')

      await updateConnector(
        row.id,
        {
          profilePolicies: {
            agent: {
              groupDefaults: { read: 'always', write: 'approval' },
              tools: { issue_refund: 'never' },
            },
          },
          expectedPolicyVersion: row.policyVersion,
        },
        testDb
      )
      expect(await resolveConnectorApprovalSpec(proposal(row, 'agent'), testDb)).toMatchObject({
        status: 'denied',
        reason: 'override',
      })
    })

    it('denies once the tool contract changes and has not been reviewed since', async () => {
      const row = await insertConnector({
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
        },
        toolReviews: null,
      })
      // Same ordering point as the annotation case: the reviewed contract is
      // recorded on the first read, so the change must follow it.
      expect((await resolveConnectorApprovalSpec(proposal(row, 'agent'), testDb)).status).toBe('ok')
      await testDb
        .update(connectors)
        .set({ tools: [READ_TOOL, { ...WRITE_TOOL, inputSchema: { type: 'object' } }] })
        .where(eq(connectors.id, row.id))

      expect(await resolveConnectorApprovalSpec(proposal(row, 'agent'), testDb)).toMatchObject({
        status: 'denied',
        reason: 'tool_unreviewed',
      })
    })

    it('reports a policy version that moved, while still resolving', async () => {
      const row = await insertConnector({
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
        },
        toolReviews: null,
      })
      await updateConnector(
        row.id,
        {
          profilePolicies: {
            agent: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
          },
          expectedPolicyVersion: row.policyVersion,
        },
        testDb
      )
      expect(await resolveConnectorApprovalSpec(proposal(row, 'agent'), testDb)).toMatchObject({
        status: 'ok',
        policyChanged: true,
      })
    })

    it('reports a tool name that is not a live connector tool as absent', async () => {
      expect(
        await resolveConnectorApprovalSpec(
          { toolName: 'close_conversation', profile: 'agent' },
          testDb
        )
      ).toEqual({ status: 'absent' })
    })
  })

  describe('dispatch', () => {
    async function specFor(row: ConnectorRow, tool: string) {
      const spec = await getConnectorSpecByToolName(
        `connector_${row.slug}__${tool}`,
        'agent',
        testDb
      )
      expect(spec).not.toBeNull()
      return spec!
    }

    const allowAll = {
      agent: { groupDefaults: { read: 'always' as const, write: 'always' as const }, tools: {} },
    }

    it('refuses arguments the declared schema rejects, before any call', async () => {
      const row = await insertConnector({ profilePolicies: allowAll, toolReviews: null })
      const spec = await specFor(row, 'issue_refund')
      expect(await spec.execute({ amountCents: 0.5 }, {} as never)).toMatchObject({ ok: false })
      expect(await spec.execute({}, {} as never)).toMatchObject({ ok: false })
    })

    it('refuses a call whose policy moved to never after the turn was assembled', async () => {
      const row = await insertConnector({ profilePolicies: allowAll, toolReviews: null })
      const spec = await specFor(row, 'issue_refund')
      await updateConnector(
        row.id,
        {
          profilePolicies: {
            agent: {
              groupDefaults: { read: 'always', write: 'always' },
              tools: { issue_refund: 'never' },
            },
          },
          expectedPolicyVersion: row.policyVersion,
        },
        testDb
      )
      expect(await spec.execute({ amountCents: 100 }, {} as never)).toMatchObject({
        ok: false,
        note: expect.stringContaining('no longer permitted'),
      })
    })

    it('refuses a call whose connector was unassigned after the turn was assembled', async () => {
      const row = await insertConnector({ profilePolicies: allowAll, toolReviews: null })
      const spec = await specFor(row, 'issue_refund')
      await testDb
        .update(connectors)
        .set({ assignments: { agent: false, copilot: false } })
        .where(eq(connectors.id, row.id))
      expect(await spec.execute({ amountCents: 100 }, {} as never)).toMatchObject({ ok: false })
    })
  })
})
