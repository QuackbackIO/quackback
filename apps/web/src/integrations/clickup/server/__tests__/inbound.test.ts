/**
 * Tests for the ClickUp inbound webhook handler.
 * HMAC verification is covered by the shared signature matrix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/integrations/sync/transport', () => ({
  integrationFetch: vi.fn(),
}))

import { clickupInboundHandler } from '@/integrations/clickup/server/inbound'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'

const config = { workspaceId: '9012345', spaceId: '90120001', channelId: '901200000001' }
const secrets = { accessToken: 'pk_test' }

const CHANGED_AT = 1764000000000
const UPDATED_AT = 1764000005000

/** A `taskStatusUpdated` delivery, trimmed to the documented fields. */
function statusPayload(historyOverrides: Record<string, unknown> = {}) {
  return {
    event: 'taskStatusUpdated',
    task_id: '86abc123',
    webhook_id: 'wh-1',
    history_items: [
      {
        id: '2800763136717140857',
        type: 1,
        date: String(CHANGED_AT),
        field: 'status',
        parent_id: 'not-a-list',
        before: { status: 'to do', type: 'open' },
        after: { status: 'in review', type: 'custom' },
        ...historyOverrides,
      },
    ],
  }
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: '86abc123',
    status: { status: 'complete', type: 'closed' },
    list: { id: '901200000001' },
    date_updated: String(UPDATED_AT),
    ...overrides,
  }
}

function parse(
  payload: unknown,
  cfg: Record<string, unknown> = config,
  sec: Record<string, unknown> = secrets
) {
  return clickupInboundHandler.parseStatusChange(JSON.stringify(payload), cfg, sec)
}

beforeEach(() => {
  vi.mocked(integrationFetch).mockReset()
  vi.mocked(integrationFetch).mockImplementation(async () => Response.json(task()))
})

describe('clickupInboundHandler.parseStatusChange', () => {
  it('declares automatic status handling', () => {
    expect(clickupInboundHandler.statusMode).toBe('automatic')
  })

  it('reads the task back and applies its current status in the configured list', async () => {
    expect(await parse(statusPayload())).toEqual({
      externalId: '86abc123',
      externalStatus: 'complete',
      eventType: 'taskStatusUpdated',
      destinationId: '901200000001',
      occurredAt: new Date(CHANGED_AT).toISOString(),
    })
    expect(integrationFetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(integrationFetch).mock.calls[0]
    expect(String(url)).toBe('https://api.clickup.com/api/v2/task/86abc123')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pk_test')
  })

  it('accepts a numeric history date', async () => {
    const result = await parse(statusPayload({ date: CHANGED_AT }))
    expect(result).toMatchObject({ occurredAt: new Date(CHANGED_AT).toISOString() })
  })

  it('falls back to the task update time when the history date is unusable', async () => {
    for (const date of [undefined, 'yesterday', '', '1e20', 0]) {
      const result = await parse(statusPayload({ date }))
      expect(result, String(date)).toMatchObject({
        occurredAt: new Date(UPDATED_AT).toISOString(),
      })
    }
  })

  it('leaves occurredAt unset when neither time is usable', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(Response.json(task({ date_updated: null })))
    const result = await parse(statusPayload({ date: 'nope' }))
    expect(result).toMatchObject({ destinationId: '901200000001' })
    expect((result as { occurredAt?: string }).occurredAt).toBeUndefined()
  })

  it('ignores a task that is not in the configured list', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(Response.json(task({ list: { id: 'other' } })))
    expect(await parse(statusPayload())).toBeNull()
  })

  it('ignores a task whose list cannot be confirmed', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(Response.json(task({ list: undefined })))
    expect(await parse(statusPayload())).toBeNull()
  })

  it('does not use the history parent_id for scope', async () => {
    const result = await parse(statusPayload({ parent_id: '901200000001' }))
    expect(result).toMatchObject({ destinationId: '901200000001' })
    vi.mocked(integrationFetch).mockResolvedValue(Response.json(task({ list: { id: 'other' } })))
    expect(await parse(statusPayload({ parent_id: '901200000001' }))).toBeNull()
  })

  it('ignores a task with no readable status', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(Response.json(task({ status: {} })))
    expect(await parse(statusPayload())).toBeNull()
  })

  it('ignores a deleted task', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(new Response('', { status: 404 }))
    expect(await parse(statusPayload())).toBeNull()
  })

  it('throws on other read failures so the receipt retries', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(new Response('', { status: 503 }))
    await expect(parse(statusPayload())).rejects.toMatchObject({ status: 503 })
    vi.mocked(integrationFetch).mockRejectedValue(new Error('timeout'))
    await expect(parse(statusPayload())).rejects.toThrow('timeout')
  })

  it('falls back to review without a stored token', async () => {
    expect(await parse(statusPayload(), config, {})).toEqual({
      externalId: '86abc123',
      externalStatus: 'in review',
      eventType: 'taskStatusUpdated',
    })
    expect(integrationFetch).not.toHaveBeenCalled()
  })

  it('falls back to review without a configured list', async () => {
    expect(await parse(statusPayload(), { workspaceId: '9012345' })).toEqual({
      externalId: '86abc123',
      externalStatus: 'in review',
      eventType: 'taskStatusUpdated',
    })
    expect(integrationFetch).not.toHaveBeenCalled()
  })

  it('ignores other events', async () => {
    expect(await parse({ ...statusPayload(), event: 'taskUpdated' })).toBeNull()
    expect(integrationFetch).not.toHaveBeenCalled()
  })

  it('ignores a status event without a status history item', async () => {
    expect(await parse(statusPayload({ field: 'name' }))).toBeNull()
    expect(await parse({ ...statusPayload(), history_items: undefined })).toBeNull()
    expect(integrationFetch).not.toHaveBeenCalled()
  })

  it('ignores a status event without a task id', async () => {
    expect(await parse({ ...statusPayload(), task_id: undefined })).toBeNull()
    expect(integrationFetch).not.toHaveBeenCalled()
  })
})
