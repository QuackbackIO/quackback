/**
 * Tests for Shortcut inbound webhook handler.
 */

import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { shortcutInboundHandler } from '@/integrations/shortcut/server/inbound'

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/webhook', { headers })
}

// The handler only reads the body; config/secrets are required by the
// InboundWebhookHandler interface signature but ignored here.
const parse = (payload: unknown) =>
  shortcutInboundHandler.parseStatusChange(JSON.stringify(payload), {}, {})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A realistic Shortcut `story-update` webhook payload. The `changes` carry the
 * numeric workflow_state_id, and the top-level `references` array maps those
 * numeric IDs to human-readable state names (Shortcut's own self-describing
 * format — see https://developer.shortcut.com/api/webhook/v1).
 */
function storyStateChangePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-event-id',
    changed_at: '2026-06-06T00:00:00Z',
    primary_id: 16,
    version: 'v1',
    actions: [
      {
        id: 16,
        entity_type: 'story',
        action: 'update',
        name: 'My story',
        changes: {
          workflow_state_id: { new: 1495, old: 1493 },
        },
      },
    ],
    references: [
      { id: 1495, entity_type: 'workflow-state', name: 'Ready for Deploy' },
      { id: 1493, entity_type: 'workflow-state', name: 'Ready for Dev' },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Status change parsing
// ---------------------------------------------------------------------------

describe('shortcutInboundHandler.parseStatusChange', () => {
  it('resolves the new workflow state name from the payload references', async () => {
    const payload = storyStateChangePayload()
    const result = await parse(payload)

    expect(result).toEqual({
      externalId: '16',
      externalStatus: 'Ready for Deploy',
      eventType: 'story.workflow_state_changed',
    })
  })

  it('returns null when no reference matches the new state ID', async () => {
    const payload = storyStateChangePayload({
      references: [{ id: 9999, entity_type: 'workflow-state', name: 'Unrelated' }],
    })
    const result = await parse(payload)
    expect(result).toBeNull()
  })

  it('ignores a matching ID whose reference is not a workflow-state', async () => {
    const payload = storyStateChangePayload({
      references: [{ id: 1495, entity_type: 'story', name: 'Decoy' }],
    })
    const result = await parse(payload)
    expect(result).toBeNull()
  })

  it('returns null when the payload has no references array', async () => {
    const payload = storyStateChangePayload({ references: undefined })
    const result = await parse(payload)
    expect(result).toBeNull()
  })

  it('returns null for non-story entity types', async () => {
    const payload = storyStateChangePayload()
    ;(payload.actions[0] as Record<string, unknown>).entity_type = 'epic'
    const result = await parse(payload)
    expect(result).toBeNull()
  })

  it('returns null for non-update actions', async () => {
    const payload = storyStateChangePayload()
    ;(payload.actions[0] as Record<string, unknown>).action = 'create'
    const result = await parse(payload)
    expect(result).toBeNull()
  })

  it('returns null when the action has no workflow_state_id change', async () => {
    const payload = storyStateChangePayload()
    ;(payload.actions[0] as Record<string, unknown>).changes = { name: { new: 'x', old: 'y' } }
    const result = await parse(payload)
    expect(result).toBeNull()
  })

  it('returns null when the payload has no actions array', async () => {
    const result = await parse({})
    expect(result).toBeNull()
  })
})

describe('shortcutInboundHandler.verifySignature', () => {
  const secret = 'webhook-secret'
  const body = '{"test": true}'

  it('returns true for a valid signature', async () => {
    const req = makeRequest({ 'Payload-Signature': sign(body, secret) })
    const result = await shortcutInboundHandler.verifySignature(req, body, secret)
    expect(result).toBe(true)
  })

  it('returns 401 when the signature header is missing', async () => {
    const result = await shortcutInboundHandler.verifySignature(makeRequest(), body, secret)
    expect(result).not.toBe(true)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 for an invalid signature', async () => {
    const req = makeRequest({ 'Payload-Signature': 'bad-sig' })
    const result = await shortcutInboundHandler.verifySignature(req, body, secret)
    expect(result).not.toBe(true)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 for a same-length but incorrect signature', async () => {
    // 64 hex chars matches the SHA-256 digest length, so this exercises the
    // constant-time compare rather than short-circuiting on the length guard.
    const req = makeRequest({ 'Payload-Signature': '0'.repeat(64) })
    const result = await shortcutInboundHandler.verifySignature(req, body, secret)
    expect(result).not.toBe(true)
    expect((result as Response).status).toBe(401)
  })
})
