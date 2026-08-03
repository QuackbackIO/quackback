import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
  mockListEvents: vi.fn(),
  mockListAuditEvents: vi.fn(),
  mockListDistinctActions: vi.fn(),
  mockListUnifiedAuditActions: vi.fn(),
  mockListUnifiedAuditEvents: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requirePermission: (...args: unknown[]) => hoisted.mockRequirePermission(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  listEvents: (...args: unknown[]) => hoisted.mockListEvents(...args),
  listAuditEvents: (...args: unknown[]) => hoisted.mockListAuditEvents(...args),
  listDistinctActions: (...args: unknown[]) => hoisted.mockListDistinctActions(...args),
}))

vi.mock('@/lib/server/domains/audit/audit.unified', () => ({
  listUnifiedAuditActions: (...args: unknown[]) => hoisted.mockListUnifiedAuditActions(...args),
  listUnifiedAuditEvents: (...args: unknown[]) => hoisted.mockListUnifiedAuditEvents(...args),
}))

await import('../audit')

const [
  listAuditEventsFn,
  listAuditEventsPagedFn,
  getAuditActionsFn,
  listUnifiedAuditEventsFn,
  getUnifiedAuditActionsFn,
] = handlersByIndex

if (!getUnifiedAuditActionsFn) {
  throw new Error(`audit handlers were not registered; found ${handlersByIndex.length}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequirePermission.mockResolvedValue(undefined)
  hoisted.mockListEvents.mockResolvedValue([{ id: 'audit_legacy' }])
  hoisted.mockListAuditEvents.mockResolvedValue({ items: [{ id: 'audit_paged' }] })
  hoisted.mockListDistinctActions.mockResolvedValue(['ticket.created'])
  hoisted.mockListUnifiedAuditEvents.mockResolvedValue({ items: [{ id: 'audit_unified' }] })
  hoisted.mockListUnifiedAuditActions.mockResolvedValue(['security.session.revoked'])
})

describe('audit server functions', () => {
  it('lists legacy audit events with converted date filters', async () => {
    const result = await listAuditEventsFn({
      data: {
        principalId: 'principal_1',
        action: 'ticket.created',
        targetType: 'ticket',
        targetId: 'ticket_1',
        sinceIso: '2026-01-01T00:00:00.000Z',
        untilIso: '2026-01-02T00:00:00.000Z',
        limit: 50,
      },
    })

    expect(result).toEqual([{ id: 'audit_legacy' }])
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.AUDIT_VIEW)
    expect(hoisted.mockListEvents).toHaveBeenCalledWith({
      principalId: 'principal_1',
      action: 'ticket.created',
      targetType: 'ticket',
      targetId: 'ticket_1',
      since: new Date('2026-01-01T00:00:00.000Z'),
      until: new Date('2026-01-02T00:00:00.000Z'),
      limit: 50,
    })
  })

  it('lists legacy audit events with omitted optional date filters', async () => {
    await listAuditEventsFn({ data: {} })

    expect(hoisted.mockListEvents).toHaveBeenCalledWith({
      principalId: undefined,
      action: undefined,
      targetType: undefined,
      targetId: undefined,
      since: undefined,
      until: undefined,
      limit: undefined,
    })
  })

  it('lists paged audit events with REST filters and converted dates', async () => {
    const result = await listAuditEventsPagedFn({
      data: {
        principalId: 'principal_1',
        action: 'ticket.created',
        actionPrefix: 'ticket.',
        targetType: 'ticket',
        targetId: 'ticket_1',
        source: 'mcp',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        cursor: 'cursor_1',
        limit: 25,
      },
    })

    expect(result).toEqual({ items: [{ id: 'audit_paged' }] })
    expect(hoisted.mockListAuditEvents).toHaveBeenCalledWith({
      principalId: 'principal_1',
      action: 'ticket.created',
      actionPrefix: 'ticket.',
      targetType: 'ticket',
      targetId: 'ticket_1',
      source: 'mcp',
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-02T00:00:00.000Z'),
      cursor: 'cursor_1',
      limit: 25,
    })
  })

  it('lists paged audit events with omitted optional date filters', async () => {
    await listAuditEventsPagedFn({ data: {} })

    expect(hoisted.mockListAuditEvents).toHaveBeenCalledWith({
      principalId: undefined,
      action: undefined,
      actionPrefix: undefined,
      targetType: undefined,
      targetId: undefined,
      source: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
      limit: undefined,
    })
  })

  it('lists audit action keys after permission checks pass', async () => {
    const result = await getAuditActionsFn({ data: {} })

    expect(result).toEqual(['ticket.created'])
    expect(hoisted.mockListDistinctActions).toHaveBeenCalledOnce()
  })

  it('lists unified audit events with converted dates and security exclusions', async () => {
    const result = await listUnifiedAuditEventsFn({
      data: {
        origin: 'security',
        principalId: 'principal_1',
        actorEmail: 'admin@example.com',
        action: 'security.session.revoked',
        actionPrefix: 'security.',
        targetType: 'session',
        targetId: 'session_1',
        source: 'system',
        from: '2026-02-01T00:00:00.000Z',
        to: '2026-02-02T00:00:00.000Z',
        cursor: 'cursor_2',
        limit: 10,
        excludeSecurityActions: ['security.secret.viewed'],
      },
    })

    expect(result).toEqual({ items: [{ id: 'audit_unified' }] })
    expect(hoisted.mockListUnifiedAuditEvents).toHaveBeenCalledWith({
      origin: 'security',
      principalId: 'principal_1',
      actorEmail: 'admin@example.com',
      action: 'security.session.revoked',
      actionPrefix: 'security.',
      targetType: 'session',
      targetId: 'session_1',
      source: 'system',
      from: new Date('2026-02-01T00:00:00.000Z'),
      to: new Date('2026-02-02T00:00:00.000Z'),
      cursor: 'cursor_2',
      limit: 10,
      excludeSecurityActions: ['security.secret.viewed'],
    })
  })

  it('lists unified audit events with omitted optional date filters', async () => {
    await listUnifiedAuditEventsFn({ data: {} })

    expect(hoisted.mockListUnifiedAuditEvents).toHaveBeenCalledWith({
      origin: undefined,
      principalId: undefined,
      actorEmail: undefined,
      action: undefined,
      actionPrefix: undefined,
      targetType: undefined,
      targetId: undefined,
      source: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
      limit: undefined,
      excludeSecurityActions: undefined,
    })
  })

  it('lists unified audit action keys after permission checks pass', async () => {
    const result = await getUnifiedAuditActionsFn({ data: {} })

    expect(result).toEqual(['security.session.revoked'])
    expect(hoisted.mockListUnifiedAuditActions).toHaveBeenCalledOnce()
  })

  it('does not call audit domains when the audit.view permission check fails', async () => {
    hoisted.mockRequirePermission.mockRejectedValueOnce(new Error('audit.view required'))

    await expect(listAuditEventsFn({ data: {} })).rejects.toThrow('audit.view required')

    expect(hoisted.mockListEvents).not.toHaveBeenCalled()
    expect(hoisted.mockListAuditEvents).not.toHaveBeenCalled()
    expect(hoisted.mockListUnifiedAuditEvents).not.toHaveBeenCalled()
  })
})
