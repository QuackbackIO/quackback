import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  workspaceLimitMock: vi.fn(),
  securityLimitMock: vi.fn(),
  workspaceActionsLimitMock: vi.fn(),
  securityActionsLimitMock: vi.fn(),
  workspaceWhereMock: vi.fn(),
  securityWhereMock: vi.fn(),
  workspaceOrderByMock: vi.fn(),
  securityOrderByMock: vi.fn(),
  workspaceLeftJoinMock: vi.fn(),
  selectMock: vi.fn(),
  selectDistinctMock: vi.fn(),
  andMock: vi.fn(),
  descMock: vi.fn(),
  eqMock: vi.fn(),
  gteMock: vi.fn(),
  ilikeMock: vi.fn(),
  likeMock: vi.fn(),
  ltMock: vi.fn(),
  lteMock: vi.fn(),
  notInArrayMock: vi.fn(),
  orMock: vi.fn(),
}))

function tableChain(kind: 'workspace' | 'security') {
  const chain = {
    leftJoin: (...args: unknown[]) => {
      hoisted.workspaceLeftJoinMock(...args)
      return chain
    },
    where: (condition: unknown) => {
      if (kind === 'workspace') hoisted.workspaceWhereMock(condition)
      else hoisted.securityWhereMock(condition)
      return chain
    },
    orderBy: (...args: unknown[]) => {
      if (kind === 'workspace') hoisted.workspaceOrderByMock(...args)
      else hoisted.securityOrderByMock(...args)
      return chain
    },
    limit: (limit: number) =>
      kind === 'workspace' ? hoisted.workspaceLimitMock(limit) : hoisted.securityLimitMock(limit),
  }
  return chain
}

function distinctChain(kind: 'workspace' | 'security') {
  const chain = {
    orderBy: () => chain,
    limit: (limit: number) =>
      kind === 'workspace'
        ? hoisted.workspaceActionsLimitMock(limit)
        : hoisted.securityActionsLimitMock(limit),
  }
  return chain
}

vi.mock('@/lib/server/db', () => ({
  and: (...args: unknown[]) => hoisted.andMock(...args),
  auditEvents: {
    _table: 'workspace',
    id: 'auditEvents.id',
    createdAt: 'auditEvents.createdAt',
    principalId: 'auditEvents.principalId',
    action: 'auditEvents.action',
    targetType: 'auditEvents.targetType',
    targetId: 'auditEvents.targetId',
    diff: 'auditEvents.diff',
    source: 'auditEvents.source',
    ipAddress: 'auditEvents.ipAddress',
    userAgent: 'auditEvents.userAgent',
  },
  auditLog: {
    _table: 'security',
    id: 'auditLog.id',
    occurredAt: 'auditLog.occurredAt',
    actorUserId: 'auditLog.actorUserId',
    actorEmail: 'auditLog.actorEmail',
    actorRole: 'auditLog.actorRole',
    actorIp: 'auditLog.actorIp',
    actorUserAgent: 'auditLog.actorUserAgent',
    eventType: 'auditLog.eventType',
    eventOutcome: 'auditLog.eventOutcome',
    targetType: 'auditLog.targetType',
    targetId: 'auditLog.targetId',
    beforeValue: 'auditLog.beforeValue',
    afterValue: 'auditLog.afterValue',
    metadata: 'auditLog.metadata',
    requestId: 'auditLog.requestId',
    actorType: 'auditLog.actorType',
    authMethod: 'auditLog.authMethod',
  },
  db: {
    select: (...args: unknown[]) => hoisted.selectMock(...args),
    selectDistinct: (...args: unknown[]) => hoisted.selectDistinctMock(...args),
  },
  desc: (...args: unknown[]) => hoisted.descMock(...args),
  eq: (...args: unknown[]) => hoisted.eqMock(...args),
  gte: (...args: unknown[]) => hoisted.gteMock(...args),
  ilike: (...args: unknown[]) => hoisted.ilikeMock(...args),
  like: (...args: unknown[]) => hoisted.likeMock(...args),
  lt: (...args: unknown[]) => hoisted.ltMock(...args),
  lte: (...args: unknown[]) => hoisted.lteMock(...args),
  notInArray: (...args: unknown[]) => hoisted.notInArrayMock(...args),
  or: (...args: unknown[]) => hoisted.orMock(...args),
  principal: {
    id: 'principal.id',
    userId: 'principal.userId',
    displayName: 'principal.displayName',
    role: 'principal.role',
    type: 'principal.type',
  },
  user: {
    id: 'user.id',
    email: 'user.email',
    name: 'user.name',
  },
}))

import {
  decodeUnifiedAuditCursor,
  encodeUnifiedAuditCursor,
  listUnifiedAuditActions,
  listUnifiedAuditEvents,
  pageUnifiedAuditRows,
  type UnifiedAuditEventRow,
} from '../audit.unified'

function row(overrides: Partial<UnifiedAuditEventRow>): UnifiedAuditEventRow {
  return {
    id: 'audit_default',
    origin: 'workspace',
    occurredAt: new Date('2026-06-01T12:00:00.000Z'),
    principalId: null,
    actorUserId: null,
    actorEmail: null,
    actorDisplayName: null,
    actorRole: null,
    actorType: null,
    authMethod: null,
    action: 'ticket.created',
    outcome: null,
    source: 'web',
    targetType: 'ticket',
    targetId: 'ticket_1',
    requestId: null,
    ipAddress: null,
    userAgent: null,
    diff: {},
    metadata: null,
    ...overrides,
  }
}

function workspaceDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit_workspace',
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    principalId: 'principal_1',
    action: 'ticket.created',
    targetType: 'ticket',
    targetId: 'ticket_1',
    diff: { after: { title: 'Hello' } },
    source: 'web',
    ipAddress: '203.0.113.10',
    userAgent: 'vitest',
    actorUserId: 'user_1',
    actorEmail: 'agent@example.com',
    actorDisplayName: null,
    actorRole: 'admin',
    actorType: 'user',
    userName: 'Agent User',
    ...overrides,
  }
}

function securityDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit_security',
    occurredAt: new Date('2026-06-01T12:01:00.000Z'),
    actorUserId: 'user_2',
    actorEmail: 'security@example.com',
    actorRole: 'admin',
    actorIp: '203.0.113.11',
    actorUserAgent: 'vitest-security',
    eventType: 'auth.signin.success',
    eventOutcome: 'success',
    targetType: 'user',
    targetId: 'user_2',
    beforeValue: { enabled: false },
    afterValue: { enabled: true },
    metadata: { provider: 'sso' },
    requestId: 'req_123',
    actorType: 'user',
    authMethod: 'sso',
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  hoisted.andMock.mockImplementation((...parts: unknown[]) => ['and', ...parts])
  hoisted.descMock.mockImplementation((column: unknown) => ['desc', column])
  hoisted.eqMock.mockImplementation((left: unknown, right: unknown) => ['eq', left, right])
  hoisted.gteMock.mockImplementation((left: unknown, right: unknown) => ['gte', left, right])
  hoisted.ilikeMock.mockImplementation((left: unknown, right: unknown) => ['ilike', left, right])
  hoisted.likeMock.mockImplementation((left: unknown, right: unknown) => ['like', left, right])
  hoisted.ltMock.mockImplementation((left: unknown, right: unknown) => ['lt', left, right])
  hoisted.lteMock.mockImplementation((left: unknown, right: unknown) => ['lte', left, right])
  hoisted.notInArrayMock.mockImplementation((left: unknown, right: unknown) => [
    'notInArray',
    left,
    right,
  ])
  hoisted.orMock.mockImplementation((...parts: unknown[]) => ['or', ...parts])
  hoisted.selectMock.mockReturnValue({
    from: (table: { _table?: 'workspace' | 'security' }) => tableChain(table._table ?? 'workspace'),
  })
  hoisted.selectDistinctMock.mockReturnValue({
    from: (table: { _table?: 'workspace' | 'security' }) =>
      distinctChain(table._table ?? 'workspace'),
  })
  hoisted.workspaceLimitMock.mockResolvedValue([])
  hoisted.securityLimitMock.mockResolvedValue([])
  hoisted.workspaceActionsLimitMock.mockResolvedValue([])
  hoisted.securityActionsLimitMock.mockResolvedValue([])
})

describe('pageUnifiedAuditRows', () => {
  it('sorts mixed workspace and security rows by timestamp, origin, then id', () => {
    const page = pageUnifiedAuditRows(
      [
        row({
          id: 'audit_a',
          origin: 'security',
          occurredAt: new Date('2026-06-01T12:00:00.000Z'),
          action: 'auth.signin.success',
        }),
        row({
          id: 'audit_b',
          origin: 'workspace',
          occurredAt: new Date('2026-06-01T12:00:00.000Z'),
          action: 'ticket.updated',
        }),
        row({
          id: 'audit_c',
          origin: 'workspace',
          occurredAt: new Date('2026-06-01T12:01:00.000Z'),
          action: 'role.granted',
        }),
      ],
      { limit: 10 }
    )

    expect(page.items.map((item) => `${item.origin}:${item.id}`)).toEqual([
      'workspace:audit_c',
      'workspace:audit_b',
      'security:audit_a',
    ])
  })

  it('paginates without duplicates when the cursor lands between origins at the same timestamp', () => {
    const rows = [
      row({
        id: 'audit_c',
        origin: 'workspace',
        occurredAt: new Date('2026-06-01T12:00:00.000Z'),
      }),
      row({
        id: 'audit_b',
        origin: 'workspace',
        occurredAt: new Date('2026-06-01T12:00:00.000Z'),
      }),
      row({
        id: 'audit_z',
        origin: 'security',
        occurredAt: new Date('2026-06-01T12:00:00.000Z'),
      }),
    ]

    const first = pageUnifiedAuditRows(rows, { limit: 2 })
    const second = pageUnifiedAuditRows(rows, { limit: 2, cursor: first.nextCursor ?? undefined })

    expect(first.items.map((item) => `${item.origin}:${item.id}`)).toEqual([
      'workspace:audit_c',
      'workspace:audit_b',
    ])
    expect(second.items.map((item) => `${item.origin}:${item.id}`)).toEqual(['security:audit_z'])
  })

  it('preserves security observability fields in paged rows', () => {
    const security = row({
      id: 'audit_security',
      origin: 'security',
      action: 'auth.signin.success',
      outcome: 'success',
      requestId: 'req_abc123',
      actorType: 'user',
      authMethod: 'sso',
      metadata: { method: 'sso' },
    })

    const page = pageUnifiedAuditRows([security], {
      cursor: encodeUnifiedAuditCursor(
        row({
          id: 'audit_newer',
          origin: 'workspace',
          occurredAt: new Date('2026-06-01T12:01:00.000Z'),
        })
      ),
    })

    expect(page.items[0]).toMatchObject({
      requestId: 'req_abc123',
      actorType: 'user',
      authMethod: 'sso',
      metadata: { method: 'sso' },
    })
  })

  it('decodes missing, malformed, and valid cursors defensively', () => {
    expect(decodeUnifiedAuditCursor(undefined)).toBeNull()
    expect(decodeUnifiedAuditCursor('not-valid-base64-json')).toBeNull()
    expect(
      decodeUnifiedAuditCursor(
        Buffer.from(JSON.stringify({ t: 'bad', o: 'workspace', i: 'x' })).toString('base64url')
      )
    ).toBeNull()

    const cursor = encodeUnifiedAuditCursor(
      row({ id: 'audit_cursor', occurredAt: new Date('2026-06-01T12:02:00.000Z') })
    )
    expect(decodeUnifiedAuditCursor(cursor)).toEqual({
      t: new Date('2026-06-01T12:02:00.000Z').getTime(),
      o: 'workspace',
      i: 'audit_cursor',
    })
  })
})

describe('listUnifiedAuditEvents', () => {
  it('queries workspace and security audit stores, normalizes rows, and applies shared filters', async () => {
    hoisted.workspaceLimitMock.mockResolvedValue([
      workspaceDbRow({ actorDisplayName: null, userName: 'Workspace Agent' }),
    ])
    hoisted.securityLimitMock.mockResolvedValue([securityDbRow()])
    const cursor = encodeUnifiedAuditCursor(
      row({
        id: 'audit_cursor',
        origin: 'security',
        occurredAt: new Date('2026-06-01T12:02:00.000Z'),
      })
    )

    const page = await listUnifiedAuditEvents({
      actionPrefix: 'ticket.',
      targetType: 'ticket',
      targetId: 'ticket_1',
      actorEmail: ' Agent ',
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-02T00:00:00.000Z'),
      cursor,
      limit: 500,
    })

    expect(page.items).toHaveLength(2)
    expect(page.items[0]).toMatchObject({
      id: 'audit_security',
      origin: 'security',
      action: 'auth.signin.success',
      outcome: 'success',
      requestId: 'req_123',
      ipAddress: '203.0.113.11',
      userAgent: 'vitest-security',
      diff: {
        before: { enabled: false },
        after: { enabled: true },
        context: {
          metadata: { provider: 'sso' },
          requestId: 'req_123',
          actorType: 'user',
          authMethod: 'sso',
        },
      },
    })
    expect(page.items[1]).toMatchObject({
      id: 'audit_workspace',
      origin: 'workspace',
      actorDisplayName: 'Workspace Agent',
      source: 'web',
      diff: { after: { title: 'Hello' } },
    })
    expect(hoisted.workspaceLimitMock).toHaveBeenCalledWith(201)
    expect(hoisted.securityLimitMock).toHaveBeenCalledWith(201)
    expect(hoisted.ilikeMock).toHaveBeenCalledWith('user.email', '%Agent%')
    expect(hoisted.ilikeMock).toHaveBeenCalledWith('auditLog.actorEmail', '%Agent%')
    expect(hoisted.workspaceWhereMock).toHaveBeenCalledWith(expect.arrayContaining(['and']))
    expect(hoisted.securityWhereMock).toHaveBeenCalledWith(expect.arrayContaining(['and']))
    expect(hoisted.workspaceLeftJoinMock).toHaveBeenCalledTimes(2)
  })

  it('queries only workspace rows when workspace-only filters cannot apply to security audit', async () => {
    const workspace = workspaceDbRow({
      id: 'audit_workspace_only',
      actorDisplayName: 'Direct Name',
      userName: 'Fallback Name',
    })
    hoisted.workspaceLimitMock.mockResolvedValue([workspace])

    const page = await listUnifiedAuditEvents({
      principalId: 'principal_1' as never,
      source: 'api',
      action: 'ticket.updated',
      limit: 0,
    })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      id: 'audit_workspace_only',
      actorDisplayName: 'Direct Name',
      source: 'web',
    })
    expect(hoisted.workspaceLimitMock).toHaveBeenCalledWith(2)
    expect(hoisted.securityLimitMock).not.toHaveBeenCalled()
    expect(hoisted.eqMock).toHaveBeenCalledWith('auditEvents.principalId', 'principal_1')
    expect(hoisted.eqMock).toHaveBeenCalledWith('auditEvents.source', 'api')
  })

  it('queries only security rows with exclusions and cursor ordering from a workspace cursor', async () => {
    hoisted.securityLimitMock.mockResolvedValue([
      securityDbRow({
        id: 'audit_security_contextless',
        beforeValue: null,
        afterValue: undefined,
        metadata: null,
        requestId: null,
        actorType: null,
        authMethod: null,
      }),
    ])
    const cursor = encodeUnifiedAuditCursor(
      row({
        id: 'audit_workspace_cursor',
        origin: 'workspace',
        occurredAt: new Date('2026-06-01T12:02:00.000Z'),
      })
    )

    const page = await listUnifiedAuditEvents({
      origin: 'security',
      excludeSecurityActions: ['auth.session.refresh'],
      cursor,
    })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      id: 'audit_security_contextless',
      origin: 'security',
      diff: {},
      metadata: null,
    })
    expect(hoisted.workspaceLimitMock).not.toHaveBeenCalled()
    expect(hoisted.notInArrayMock).toHaveBeenCalledWith('auditLog.eventType', [
      'auth.session.refresh',
    ])
    expect(hoisted.lteMock).toHaveBeenCalledWith(
      'auditLog.occurredAt',
      new Date('2026-06-01T12:02:00.000Z')
    )
  })
})

describe('listUnifiedAuditActions', () => {
  it('merges and sorts distinct action names across stores', async () => {
    hoisted.workspaceActionsLimitMock.mockResolvedValue([
      { action: 'ticket.updated' },
      { action: 'role.assigned' },
    ])
    hoisted.securityActionsLimitMock.mockResolvedValue([
      { action: 'auth.signin.success' },
      { action: 'ticket.updated' },
    ])

    await expect(listUnifiedAuditActions()).resolves.toEqual([
      'auth.signin.success',
      'role.assigned',
      'ticket.updated',
    ])
    expect(hoisted.workspaceActionsLimitMock).toHaveBeenCalledWith(200)
    expect(hoisted.securityActionsLimitMock).toHaveBeenCalledWith(200)
  })
})
