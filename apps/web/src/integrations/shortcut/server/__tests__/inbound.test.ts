/**
 * Tests for Shortcut inbound webhook handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

vi.mock('@/lib/server/integrations/sync/transport', () => ({
  integrationFetch: vi.fn(),
}))

import { shortcutInboundHandler } from '@/integrations/shortcut/server/inbound'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/webhook', { headers })
}

const GROUP_ID = '5f2b0c1e-0000-4000-8000-000000000001'
const config = { channelId: GROUP_ID, workspaceSlug: 'acme' }
const secrets = { accessToken: 'test-token' }

const parse = (
  payload: unknown,
  cfg: Record<string, unknown> = config,
  sec: Record<string, unknown> = secrets
) => shortcutInboundHandler.parseStatusChange(JSON.stringify(payload), cfg, sec)

/** The story as read back from the connected workspace. */
function mockStory(story: Record<string, unknown> = {}) {
  vi.mocked(integrationFetch).mockResolvedValue(
    Response.json({
      id: 16,
      group_id: GROUP_ID,
      project_id: null,
      workflow_state_id: 1495,
      updated_at: '2026-06-06T00:00:01Z',
      ...story,
    })
  )
}

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
  beforeEach(() => {
    vi.mocked(integrationFetch).mockReset()
    mockStory()
  })

  it('applies a signed state change after the story is confirmed in the connected team', async () => {
    const result = await parse(storyStateChangePayload())

    expect(result).toEqual({
      externalId: '16',
      externalStatus: 'Ready for Deploy',
      eventType: 'story.workflow_state_changed',
      destinationId: GROUP_ID,
      occurredAt: '2026-06-06T00:00:00.000Z',
    })
    expect(integrationFetch).toHaveBeenCalledWith(
      'https://api.app.shortcut.com/api/v3/stories/16',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Shortcut-Token': 'test-token' }),
      })
    )
  })

  it('ignores stories that belong to another team', async () => {
    mockStory({ group_id: '5f2b0c1e-0000-4000-8000-000000000002' })
    expect(await parse(storyStateChangePayload())).toBeNull()
  })

  it('sends stories without a team to review instead of applying them', async () => {
    mockStory({ group_id: null })
    expect(await parse(storyStateChangePayload())).toEqual({
      externalId: '16',
      externalStatus: 'Ready for Deploy',
      eventType: 'story.workflow_state_changed',
    })
  })

  it('ignores the event when the story has since moved to another state', async () => {
    mockStory({ workflow_state_id: 1500 })
    expect(await parse(storyStateChangePayload())).toBeNull()
  })

  it('ignores deleted stories', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(new Response('Not found', { status: 404 }))
    expect(await parse(storyStateChangePayload())).toBeNull()
  })

  it('throws on other read failures so the receipt retries', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(new Response('Unavailable', { status: 503 }))
    await expect(parse(storyStateChangePayload())).rejects.toMatchObject({ status: 503 })
  })

  it('falls back to review without a stored token', async () => {
    const result = await parse(storyStateChangePayload(), config, {})
    expect(result).toEqual({
      externalId: '16',
      externalStatus: 'Ready for Deploy',
      eventType: 'story.workflow_state_changed',
    })
    expect(integrationFetch).not.toHaveBeenCalled()
  })

  it('falls back to review without a configured team', async () => {
    const result = await parse(storyStateChangePayload(), { workspaceSlug: 'acme' })
    expect(result).toEqual({
      externalId: '16',
      externalStatus: 'Ready for Deploy',
      eventType: 'story.workflow_state_changed',
    })
    expect(integrationFetch).not.toHaveBeenCalled()
  })

  it('returns null when the state did not actually change', async () => {
    const payload = storyStateChangePayload()
    ;(payload.actions[0] as Record<string, unknown>).changes = {
      workflow_state_id: { new: 1495, old: 1495 },
    }
    expect(await parse(payload)).toBeNull()
    expect(integrationFetch).not.toHaveBeenCalled()
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
    expect(integrationFetch).not.toHaveBeenCalled()
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
