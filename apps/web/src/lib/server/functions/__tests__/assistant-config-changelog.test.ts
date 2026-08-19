/**
 * getAssistantConfigChangelogFn — the AI config changelog reader.
 *
 * Thin wrapper: gates on assistant.manage, then delegates the row query to
 * the shared queryAuditEvents helper (audit/log.ts), filtered to
 * ASSISTANT_CONFIG_AUDIT_EVENTS and capped at 50 rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = () => Promise<unknown>
const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockQueryAuditEvents: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/audit/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/audit/log')>()),
  queryAuditEvents: hoisted.mockQueryAuditEvents,
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { role: 'admin' },
  })
})

await import('../assistant-config-changelog')
const getChangelog = handlers[0]

const { PERMISSIONS } = await import('@/lib/shared/permissions')
const { ASSISTANT_CONFIG_AUDIT_EVENTS } = await import('@/lib/server/audit/log')

describe('getAssistantConfigChangelogFn', () => {
  it('gates on assistant.manage', async () => {
    hoisted.mockQueryAuditEvents.mockResolvedValue([])
    await getChangelog()
    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })
  })

  it('propagates a requireAuth rejection without querying', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(getChangelog()).rejects.toThrow('Access denied')
    expect(hoisted.mockQueryAuditEvents).not.toHaveBeenCalled()
  })

  it('delegates to queryAuditEvents filtered to the assistant-config event set, capped at 50', async () => {
    hoisted.mockQueryAuditEvents.mockResolvedValue([])
    await getChangelog()
    expect(hoisted.mockQueryAuditEvents).toHaveBeenCalledWith({
      eventTypes: ASSISTANT_CONFIG_AUDIT_EVENTS,
      limit: 50,
    })
  })

  it('returns the rows from queryAuditEvents unchanged', async () => {
    const rows = [
      {
        id: 'audit_1',
        eventType: 'assistant.guidance.created',
        actorEmail: 'admin@example.com',
        actorRole: 'admin',
        occurredAt: '2026-07-01T12:00:00.000Z',
        targetType: 'assistant_guidance',
        targetId: 'assistant_guidance_1',
        metadata: null,
      },
    ]
    hoisted.mockQueryAuditEvents.mockResolvedValue(rows)
    const result = await getChangelog()
    expect(result).toEqual(rows)
  })

  it('returns an empty array when there are no matching events', async () => {
    hoisted.mockQueryAuditEvents.mockResolvedValue([])
    const result = await getChangelog()
    expect(result).toEqual([])
  })
})
