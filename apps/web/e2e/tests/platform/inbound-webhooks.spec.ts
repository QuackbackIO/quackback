/**
 * Inbound status webhooks from an issue tracker: refusals, a signed Linear
 * status change reaching the linked post, and redelivery.
 *
 * Journeys: INT-I-49, INT-I-50, INT-I-52.
 *
 * The test signs each body itself with the webhook secret it seeded; nothing
 * calls Linear. This file owns the Linear row (`integrations` is unique per
 * provider), so its tests run in order, and it removes the row at the end.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import {
  createPost,
  linearSignature,
  linearStateChange,
  linkPost,
  linkScope,
  postStatusId,
  removeIntegration,
  seedIntegration,
  type SeededIntegration,
} from '../../product/integrations'

test.describe.configure({ mode: 'serial' })

const LINEAR_SCOPE_KEYS = ['workspaceId', 'organizationId', 'teamId'] as const
const SECRET = `whsec-${randomBytes(12).toString('hex')}`
const TEAM = `team-${randomBytes(4).toString('hex')}`

let linear: SeededIntegration
let complete: { id: string; uuid: string }

test.beforeAll(async () => {
  complete = await postStatusId('complete')
  linear = await seedIntegration('linear', {
    webhookSecret: SECRET,
    statusSyncEnabled: true,
    statusMappings: { Done: complete.id, Backlog: null },
  })
})

test.afterAll(async () => {
  if (linear) await removeIntegration(linear)
})

function post(api: APIRequestContext, body: string, headers: Record<string, string> = {}) {
  return api.post('/api/integrations/linear/webhook', {
    headers: { 'content-type': 'application/json', ...headers },
    data: body,
  })
}

function signed(api: APIRequestContext, body: string) {
  return post(api, body, { 'Linear-Signature': linearSignature(body, SECRET) })
}

async function receipts(deliveryBody: string): Promise<{ state: string }[]> {
  const key = (await import('node:crypto'))
    .createHash('sha256')
    .update(`linear:${deliveryBody}`)
    .digest('hex')
  return supportDb()<{ state: string }[]>`
    SELECT state FROM integration_sync_operations
    WHERE integration_id = ${linear.id} AND kind = 'receive-webhook' AND source_id = ${key}`
}

async function activity(postUuid: string): Promise<{ type: string; metadata: unknown }[]> {
  return supportDb()<{ type: string; metadata: unknown }[]>`
    SELECT type, metadata FROM post_activity WHERE post_id = ${postUuid} ORDER BY created_at`
}

test(
  'INT-I-49 inbound webhook refusals: unknown provider, bad or missing signature, oversize, not configured',
  { tag: '@core' },
  async ({ request }) => {
    const body = linearStateChange({ issueId: randomUUID(), teamId: TEAM, state: 'Done' })
    const before = await supportDb()`
      SELECT count(*)::int AS n FROM integration_sync_operations WHERE integration_id = ${linear.id}`

    const unknown = await request.post('/api/integrations/nope/webhook', { data: body })
    expect(unknown.status()).toBe(404)
    expect(await unknown.text()).toBe('Unknown integration type')
    // Slack has no inbound status webhook.
    const slack = await request.post('/api/integrations/slack/webhook', { data: body })
    expect(slack.status()).toBe(404)

    const missing = await post(request, body)
    expect(missing.status()).toBe(401)
    expect(await missing.text()).toBe('Missing signature')
    const wrong = await post(request, body, {
      'Linear-Signature': linearSignature(body, 'not-the-secret'),
    })
    expect(wrong.status()).toBe(401)
    expect(await wrong.text()).toBe('Invalid signature')

    const huge = 'x'.repeat(2 * 1024 * 1024)
    const oversize = await post(request, huge, {
      'Linear-Signature': linearSignature(huge, SECRET),
    })
    expect(oversize.status()).toBe(413)

    // Only an active connection is looked up: a paused one is not configured.
    await supportDb()`UPDATE integrations SET status = 'paused' WHERE id = ${linear.uuid}`
    try {
      const paused = await signed(request, body)
      expect(paused.status()).toBe(404)
      expect(await paused.text()).toBe('Integration not configured')
    } finally {
      await supportDb()`UPDATE integrations SET status = 'active' WHERE id = ${linear.uuid}`
    }

    // Nothing was recorded for any of them.
    const after = await supportDb()`
      SELECT count(*)::int AS n FROM integration_sync_operations WHERE integration_id = ${linear.id}`
    expect(after[0].n).toBe(before[0].n)
  }
)

test(
  'INT-I-50 INT-I-52 a signed Linear status change moves the linked post; a redelivery changes nothing',
  { tag: '@smoke' },
  async ({ request, marker, people }) => {
    const target = await createPost(marker, people.people.admin.principalId)
    const issueId = randomUUID()
    const linkId = await linkPost(
      linear,
      target.uuid,
      issueId,
      linkScope(linear, TEAM, LINEAR_SCOPE_KEYS)
    )

    const body = linearStateChange({ issueId, teamId: TEAM, state: 'Done' })
    const res = await signed(request, body)
    expect(res.status()).toBe(200)
    expect(await res.text()).toBe('OK')

    // The post takes the mapped status, with the platform's activity first.
    await pollFor(
      'the post to move to the mapped status',
      async () => {
        const [row] = await supportDb()<{ status_id: string }[]>`
          SELECT status_id FROM posts WHERE id = ${target.uuid}`
        return row?.status_id === complete.uuid ? row : null
      },
      { timeoutMs: 20_000 }
    )
    const rows = await activity(target.uuid)
    expect(rows.map((r) => r.type)).toEqual(['external.status_changed', 'status.changed'])
    expect(rows[0].metadata).toMatchObject({
      integrationType: 'linear',
      externalDisplayId: 'ENG-1',
      externalStatus: 'Done',
    })
    const [link] = await supportDb()<{ remote_state: string; remote_state_at: Date | null }[]>`
      SELECT remote_state, remote_state_at FROM post_external_links WHERE id = ${linkId}`
    expect(link.remote_state).toBe('Done')
    expect(link.remote_state_at).not.toBeNull()
    await pollFor(
      'the receipt to succeed',
      async () => ((await receipts(body))[0]?.state === 'succeeded' ? true : null),
      { timeoutMs: 20_000 }
    )

    // The provider redelivers the same body: accepted, nothing new.
    const again = await signed(request, body)
    expect(again.status()).toBe(200)
    expect(await receipts(body)).toHaveLength(1)
    // A later, genuinely new event for the same issue is its own receipt.
    const unmapped = linearStateChange({ issueId, teamId: TEAM, state: 'Backlog' })
    expect((await signed(request, unmapped)).status()).toBe(200)
    await pollFor(
      'the second event to be recorded on the post',
      async () => ((await activity(target.uuid)).length === 3 ? true : null),
      { timeoutMs: 20_000 }
    )
    // An ignored (null) mapping records what the platform said but keeps the status.
    const final = await activity(target.uuid)
    expect(final.map((r) => r.type)).toEqual([
      'external.status_changed',
      'status.changed',
      'external.status_changed',
    ])
    const [row] = await supportDb()<{ status_id: string }[]>`
      SELECT status_id FROM posts WHERE id = ${target.uuid}`
    expect(row.status_id).toBe(complete.uuid)
  }
)
