import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
  mockTicketsFindFirst: vi.fn(),
  mockWriteActivity: vi.fn(),
  mockNotifyTicketSlaBreach: vi.fn(),
  mockNotifyTicketSlaWarning: vi.fn(),
  mockDispatchTicketSlaBreach: vi.fn(),
  mockDispatchTicketSlaWarning: vi.fn(),
  mockConsoleLog: vi.fn(),
  mockConsoleWarn: vi.fn(),
  mockEq: vi.fn(),
  mockAnd: vi.fn(),
  mockLte: vi.fn(),
  mockIsNull: vi.fn(),
  mockOr: vi.fn(),
  mockSql: vi.fn(),
  insertedLogs: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...args: unknown[]) => hoisted.mockSelect(...args),
    update: (...args: unknown[]) => hoisted.mockUpdate(...args),
    insert: (...args: unknown[]) => hoisted.mockInsert(...args),
    query: {
      tickets: { findFirst: (...args: unknown[]) => hoisted.mockTicketsFindFirst(...args) },
    },
  },
  ticketSlaClocks: {
    _name: 'ticket_sla_clocks',
    id: 'ticketSlaClocks.id',
    ticketId: 'ticketSlaClocks.ticketId',
    kind: 'ticketSlaClocks.kind',
    state: 'ticketSlaClocks.state',
    dueAt: 'ticketSlaClocks.dueAt',
    policyId: 'ticketSlaClocks.policyId',
    lastEscalatedAt: 'ticketSlaClocks.lastEscalatedAt',
  },
  escalationRules: {
    _name: 'escalation_rules',
    enabled: 'escalationRules.enabled',
  },
  slaEscalationLog: {
    _name: 'sla_escalation_log',
  },
  tickets: {
    _name: 'tickets',
    id: 'tickets.id',
  },
  inboxMemberships: {
    _name: 'inbox_memberships',
    inboxId: 'inboxMemberships.inboxId',
    principalId: 'inboxMemberships.principalId',
  },
  eq: (...args: unknown[]) => hoisted.mockEq(...args),
  and: (...args: unknown[]) => hoisted.mockAnd(...args),
  lte: (...args: unknown[]) => hoisted.mockLte(...args),
  isNull: (...args: unknown[]) => hoisted.mockIsNull(...args),
  or: (...args: unknown[]) => hoisted.mockOr(...args),
  sql: (...args: unknown[]) => hoisted.mockSql(...args),
}))

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  writeActivity: (...args: unknown[]) => hoisted.mockWriteActivity(...args),
}))

vi.mock('@/lib/server/domains/tickets/ticket.notifications', () => ({
  notifyTicketSlaBreach: (...args: unknown[]) => hoisted.mockNotifyTicketSlaBreach(...args),
  notifyTicketSlaWarning: (...args: unknown[]) => hoisted.mockNotifyTicketSlaWarning(...args),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchTicketSlaBreach: (...args: unknown[]) => hoisted.mockDispatchTicketSlaBreach(...args),
  dispatchTicketSlaWarning: (...args: unknown[]) => hoisted.mockDispatchTicketSlaWarning(...args),
}))

const { runEscalationTick } = await import('../sla.escalations')

type SelectChain = {
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  then: Promise<unknown[]>['then']
  catch: Promise<unknown[]>['catch']
  finally: Promise<unknown[]>['finally']
}

function makeSelectChain(rows: unknown[]): SelectChain {
  const promise = Promise.resolve(rows)
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  } as SelectChain
  return chain
}

function makeUpdateChain(rows: unknown[]) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  }
}

function makeInsertLogChain() {
  const promise = Promise.resolve(undefined)
  return {
    values: vi.fn((value: Record<string, unknown>) => {
      hoisted.insertedLogs.push(value)
      return {
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
        finally: promise.finally.bind(promise),
      }
    }),
  }
}

function clock(overrides: Record<string, unknown> = {}) {
  return {
    id: 'clock_1',
    ticketId: 'ticket_1',
    policyId: 'sla_1',
    kind: 'resolution',
    state: 'running',
    dueAt: new Date('2026-01-01T10:00:00.000Z'),
    lastEscalatedAt: null,
    ...overrides,
  }
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule_1',
    policyId: 'sla_1',
    name: 'Warn owners',
    leadMinutes: 30,
    targetKind: 'resolution',
    recipientType: 'principals',
    recipientPrincipalIds: ['principal_1'],
    recipientTeamId: null,
    channels: ['in_app'],
    enabled: true,
    ...overrides,
  }
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket_1',
    subject: 'Help',
    assigneePrincipalId: 'principal_assignee',
    inboxId: 'inbox_1',
    ...overrides,
  }
}

beforeEach(() => {
  hoisted.mockSelect.mockReset()
  hoisted.mockUpdate.mockReset()
  hoisted.mockInsert.mockReset()
  hoisted.mockTicketsFindFirst.mockReset()
  hoisted.mockWriteActivity.mockReset()
  hoisted.mockNotifyTicketSlaBreach.mockReset()
  hoisted.mockNotifyTicketSlaWarning.mockReset()
  hoisted.mockDispatchTicketSlaBreach.mockReset()
  hoisted.mockDispatchTicketSlaWarning.mockReset()
  hoisted.mockConsoleLog.mockReset()
  hoisted.mockConsoleWarn.mockReset()
  hoisted.mockEq.mockReset()
  hoisted.mockAnd.mockReset()
  hoisted.mockLte.mockReset()
  hoisted.mockIsNull.mockReset()
  hoisted.mockOr.mockReset()
  hoisted.mockSql.mockReset()
  hoisted.insertedLogs.length = 0

  hoisted.mockEq.mockImplementation((...args: unknown[]) => ['eq', ...args])
  hoisted.mockAnd.mockImplementation((...args: unknown[]) => ['and', ...args])
  hoisted.mockLte.mockImplementation((...args: unknown[]) => ['lte', ...args])
  hoisted.mockIsNull.mockImplementation((...args: unknown[]) => ['isNull', ...args])
  hoisted.mockOr.mockImplementation((...args: unknown[]) => ['or', ...args])
  hoisted.mockSql.mockImplementation((...args: unknown[]) => ['sql', ...args])
  hoisted.mockInsert.mockImplementation(() => makeInsertLogChain())
  hoisted.mockWriteActivity.mockResolvedValue({ id: 'activity_1' })
  hoisted.mockNotifyTicketSlaBreach.mockResolvedValue(undefined)
  hoisted.mockNotifyTicketSlaWarning.mockResolvedValue(undefined)
  hoisted.mockDispatchTicketSlaBreach.mockResolvedValue(undefined)
  hoisted.mockDispatchTicketSlaWarning.mockResolvedValue(undefined)
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) =>
    hoisted.mockConsoleLog(...args)
  )
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) =>
    hoisted.mockConsoleWarn(...args)
  )
})

describe('runEscalationTick', () => {
  it('marks due clocks as breached and dispatches breach notifications and webhooks', async () => {
    const due = clock({
      id: 'clock_due',
      kind: 'first_response',
      dueAt: '2026-01-01T10:00:00.000Z',
    })
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([due]))
      .mockReturnValueOnce(makeSelectChain([]))
    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([due]))
    hoisted.mockTicketsFindFirst.mockResolvedValueOnce(ticket({ id: 'ticket_1' }))

    const result = await runEscalationTick({
      now: new Date('2026-01-01T10:05:00.000Z'),
      batchSize: 5,
    })

    expect(result).toEqual({ breached: 1, escalated: 0, considered: 0 })
    expect(hoisted.mockWriteActivity).toHaveBeenCalledWith('ticket_1', null, 'sla.breached', {
      clockId: 'clock_due',
      kind: 'first_response',
      dueAt: '2026-01-01T10:00:00.000Z',
    })
    expect(hoisted.mockNotifyTicketSlaBreach).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ticket_1' }),
      'first_response'
    )
    expect(hoisted.mockDispatchTicketSlaBreach).toHaveBeenCalledWith(
      { type: 'service', displayName: 'sla-engine' },
      expect.objectContaining({ id: 'ticket_1' }),
      'first_response'
    )
  })

  it('skips breach side effects when the concurrency update loses the race', async () => {
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([clock({ id: 'clock_due' })]))
      .mockReturnValueOnce(makeSelectChain([]))
    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([]))

    await expect(runEscalationTick()).resolves.toEqual({ breached: 0, escalated: 0, considered: 0 })
    expect(hoisted.mockNotifyTicketSlaBreach).not.toHaveBeenCalled()
  })

  it('logs principal-recipient escalations, warns via in-app, and defers non-in-app channels', async () => {
    const candidate = clock({ id: 'clock_warn' })
    const escalationRule = rule({
      id: 'rule_principals',
      name: 'Warn principals',
      channels: ['in_app', 'email'],
      recipientPrincipalIds: ['principal_1', 'principal_2'],
    })
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([escalationRule]))
      .mockReturnValueOnce(makeSelectChain([candidate]))
    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([candidate]))
    hoisted.mockTicketsFindFirst.mockResolvedValueOnce(ticket())

    const result = await runEscalationTick({ now: new Date('2026-01-01T09:45:00.000Z') })

    expect(result).toEqual({ breached: 0, escalated: 1, considered: 1 })
    expect(hoisted.mockNotifyTicketSlaWarning).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ticket_1' }),
      'resolution',
      'Warn principals',
      ['principal_1', 'principal_2']
    )
    expect(hoisted.mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('non-in_app channels deferred')
    )
    expect(hoisted.insertedLogs).toEqual([
      expect.objectContaining({
        clockId: 'clock_warn',
        ruleId: 'rule_principals',
        recipientPrincipalIds: ['principal_1', 'principal_2'],
        channels: ['in_app', 'email'],
        context: expect.objectContaining({ ticketId: 'ticket_1', leadMinutes: 30 }),
      }),
    ])
    expect(hoisted.mockWriteActivity).toHaveBeenCalledWith(
      'ticket_1',
      null,
      'sla.escalated',
      expect.objectContaining({ ruleId: 'rule_principals', recipientCount: 2 })
    )
  })

  it('supports team recipient fallbacks and default empty channel arrays', async () => {
    const candidate = clock({ id: 'clock_team' })
    const teamRule = rule({
      id: 'rule_team',
      recipientType: 'team',
      recipientPrincipalIds: undefined,
      channels: undefined,
    })
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([teamRule]))
      .mockReturnValueOnce(makeSelectChain([candidate]))
    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([candidate]))

    const result = await runEscalationTick()

    expect(result).toEqual({ breached: 0, escalated: 1, considered: 1 })
    expect(hoisted.mockNotifyTicketSlaWarning).not.toHaveBeenCalled()
    expect(hoisted.insertedLogs).toEqual([
      expect.objectContaining({
        ruleId: 'rule_team',
        recipientPrincipalIds: [],
        channels: undefined,
      }),
    ])
  })

  it('resolves assignee and inbox-member escalation recipients', async () => {
    const assigneeRule = rule({
      id: 'rule_assignee',
      recipientType: 'assignee',
      recipientPrincipalIds: [],
    })
    const inboxRule = rule({
      id: 'rule_inbox',
      recipientType: 'inbox_members',
      recipientPrincipalIds: [],
    })
    const assigneeClock = clock({ id: 'clock_assignee' })
    const inboxClock = clock({ id: 'clock_inbox' })
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([assigneeRule, inboxRule]))
      .mockReturnValueOnce(makeSelectChain([assigneeClock]))
      .mockReturnValueOnce(makeSelectChain([inboxClock]))
      .mockReturnValueOnce(
        makeSelectChain([{ principalId: 'principal_a' }, { principalId: 'principal_b' }])
      )
    hoisted.mockUpdate
      .mockReturnValueOnce(makeUpdateChain([assigneeClock]))
      .mockReturnValueOnce(makeUpdateChain([inboxClock]))
    hoisted.mockTicketsFindFirst
      .mockResolvedValueOnce(ticket({ assigneePrincipalId: 'principal_assignee' }))
      .mockResolvedValueOnce(ticket())
      .mockResolvedValueOnce(ticket({ inboxId: 'inbox_1' }))
      .mockResolvedValueOnce(ticket())

    const result = await runEscalationTick()

    expect(result.escalated).toBe(2)
    expect(hoisted.mockNotifyTicketSlaWarning).toHaveBeenCalledWith(
      expect.any(Object),
      'resolution',
      'Warn owners',
      ['principal_assignee']
    )
    expect(hoisted.mockNotifyTicketSlaWarning).toHaveBeenCalledWith(
      expect.any(Object),
      'resolution',
      'Warn owners',
      ['principal_a', 'principal_b']
    )
  })

  it('returns no recipients for unassigned or uninboxed escalation targets', async () => {
    const assigneeRule = rule({
      id: 'rule_assignee_empty',
      recipientType: 'assignee',
      recipientPrincipalIds: [],
    })
    const inboxRule = rule({
      id: 'rule_inbox_empty',
      recipientType: 'inbox_members',
      recipientPrincipalIds: [],
    })
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([assigneeRule, inboxRule]))
      .mockReturnValueOnce(makeSelectChain([clock({ id: 'clock_assignee_empty' })]))
      .mockReturnValueOnce(makeSelectChain([clock({ id: 'clock_inbox_empty' })]))
    hoisted.mockUpdate
      .mockReturnValueOnce(makeUpdateChain([clock({ id: 'clock_assignee_empty' })]))
      .mockReturnValueOnce(makeUpdateChain([clock({ id: 'clock_inbox_empty' })]))
    hoisted.mockTicketsFindFirst
      .mockResolvedValueOnce(ticket({ assigneePrincipalId: null }))
      .mockResolvedValueOnce(ticket({ inboxId: null }))

    const result = await runEscalationTick()

    expect(result.escalated).toBe(2)
    expect(hoisted.mockNotifyTicketSlaWarning).not.toHaveBeenCalled()
    expect(hoisted.insertedLogs.map((entry) => entry.recipientPrincipalIds)).toEqual([[], []])
  })

  it('counts considered clocks without logging when the escalation anti-spam update loses', async () => {
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([rule()]))
      .mockReturnValueOnce(makeSelectChain([clock({ id: 'clock_raced' })]))
    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([]))

    const result = await runEscalationTick()

    expect(result).toEqual({ breached: 0, escalated: 0, considered: 1 })
    expect(hoisted.insertedLogs).toEqual([])
    expect(hoisted.mockNotifyTicketSlaWarning).not.toHaveBeenCalled()
  })

  it('swallows notification and webhook dispatch failures after the clock update succeeds', async () => {
    const due = clock({ id: 'clock_due' })
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([due]))
      .mockReturnValueOnce(makeSelectChain([]))
    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([due]))
    hoisted.mockTicketsFindFirst.mockResolvedValueOnce(ticket())
    hoisted.mockNotifyTicketSlaBreach.mockRejectedValueOnce(new Error('mail down'))

    await expect(runEscalationTick()).resolves.toMatchObject({ breached: 1 })
    expect(hoisted.mockConsoleWarn).toHaveBeenCalledWith(
      '[sla.escalations] dispatchBreachNotification failed',
      expect.any(Error)
    )
  })

  it('returns quietly when breach or warning notification tickets disappear', async () => {
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([clock({ id: 'clock_due_missing_ticket' })]))
      .mockReturnValueOnce(makeSelectChain([rule({ id: 'rule_missing_ticket' })]))
      .mockReturnValueOnce(makeSelectChain([clock({ id: 'clock_warning_missing_ticket' })]))
    hoisted.mockUpdate
      .mockReturnValueOnce(makeUpdateChain([clock({ id: 'clock_due_missing_ticket' })]))
      .mockReturnValueOnce(makeUpdateChain([clock({ id: 'clock_warning_missing_ticket' })]))
    hoisted.mockTicketsFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const result = await runEscalationTick()

    expect(result).toEqual({ breached: 1, escalated: 1, considered: 1 })
    expect(hoisted.mockNotifyTicketSlaBreach).not.toHaveBeenCalled()
    expect(hoisted.mockNotifyTicketSlaWarning).not.toHaveBeenCalled()
  })

  it('logs warning webhook failures without failing the escalation tick', async () => {
    const candidate = clock({ id: 'clock_warn_dispatch_fail' })
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([rule({ id: 'rule_warn_dispatch_fail' })]))
      .mockReturnValueOnce(makeSelectChain([candidate]))
    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([candidate]))
    hoisted.mockTicketsFindFirst.mockResolvedValueOnce(ticket())
    hoisted.mockDispatchTicketSlaWarning.mockRejectedValueOnce(new Error('webhook down'))

    await expect(runEscalationTick()).resolves.toMatchObject({ escalated: 1 })
    expect(hoisted.mockConsoleWarn).toHaveBeenCalledWith(
      '[sla.escalations] dispatchTicketSlaWarning failed',
      expect.any(Error)
    )
  })
})
