import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
  mockBusinessHoursFindFirst: vi.fn(),
  mockSlaPoliciesFindFirst: vi.fn(),
  mockTicketSlaClocksFindFirst: vi.fn(),
  mockWriteActivity: vi.fn(),
  mockEq: vi.fn(),
  mockAnd: vi.fn(),
  mockOr: vi.fn(),
  mockIsNull: vi.fn(),
  mockAsc: vi.fn(),
  mockInArray: vi.fn(),
  mockSql: vi.fn(),
  updateSets: [] as Record<string, unknown>[],
  insertValues: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...args: unknown[]) => hoisted.mockSelect(...args),
    update: (...args: unknown[]) => hoisted.mockUpdate(...args),
    insert: (...args: unknown[]) => hoisted.mockInsert(...args),
    query: {
      businessHours: {
        findFirst: (...args: unknown[]) => hoisted.mockBusinessHoursFindFirst(...args),
      },
      slaPolicies: { findFirst: (...args: unknown[]) => hoisted.mockSlaPoliciesFindFirst(...args) },
      ticketSlaClocks: {
        findFirst: (...args: unknown[]) => hoisted.mockTicketSlaClocksFindFirst(...args),
      },
    },
  },
  businessHours: {
    _name: 'business_hours',
    id: 'businessHours.id',
  },
  slaPolicies: {
    _name: 'sla_policies',
    id: 'slaPolicies.id',
    enabled: 'slaPolicies.enabled',
    archivedAt: 'slaPolicies.archivedAt',
    scope: 'slaPolicies.scope',
    scopeTeamId: 'slaPolicies.scopeTeamId',
    scopeInboxId: 'slaPolicies.scopeInboxId',
    priority: 'slaPolicies.priority',
    createdAt: 'slaPolicies.createdAt',
  },
  slaTargets: {
    _name: 'sla_targets',
    policyId: 'slaTargets.policyId',
  },
  ticketSlaClocks: {
    _name: 'ticket_sla_clocks',
    id: 'ticketSlaClocks.id',
    ticketId: 'ticketSlaClocks.ticketId',
    kind: 'ticketSlaClocks.kind',
    state: 'ticketSlaClocks.state',
  },
  tickets: {
    _name: 'tickets',
    id: 'tickets.id',
  },
  eq: (...args: unknown[]) => hoisted.mockEq(...args),
  and: (...args: unknown[]) => hoisted.mockAnd(...args),
  or: (...args: unknown[]) => hoisted.mockOr(...args),
  isNull: (...args: unknown[]) => hoisted.mockIsNull(...args),
  asc: (...args: unknown[]) => hoisted.mockAsc(...args),
  inArray: (...args: unknown[]) => hoisted.mockInArray(...args),
  sql: (...args: unknown[]) => hoisted.mockSql(...args),
}))

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  writeActivity: (...args: unknown[]) => hoisted.mockWriteActivity(...args),
}))

const engine = await import('../sla.engine')

type ThenableChain = {
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  orderBy: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  then: Promise<unknown[]>['then']
  catch: Promise<unknown[]>['catch']
  finally: Promise<unknown[]>['finally']
}

function makeSelectChain(rows: unknown[]): ThenableChain {
  const promise = Promise.resolve(rows)
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  } as ThenableChain
  return chain
}

function makeUpdateChain() {
  const promise = Promise.resolve(undefined)
  const chain = {
    set: vi.fn((value: Record<string, unknown>) => {
      hoisted.updateSets.push(value)
      return chain
    }),
    where: vi.fn(() => chain),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
  return chain
}

function makeInsertChain(rows: unknown[]) {
  return {
    values: vi.fn((value: Record<string, unknown>) => {
      hoisted.insertValues.push(value)
      return {
        returning: vi.fn().mockResolvedValue(rows),
      }
    }),
  }
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sla_workspace',
    name: 'Workspace SLA',
    scope: 'workspace',
    scopeTeamId: null,
    scopeInboxId: null,
    priority: 100,
    appliesToPriorities: [],
    businessHoursId: null,
    pauseOnPending: true,
    pauseOnOnHold: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function target(kind: string, minutes = 30, id = `target_${kind}`) {
  return { id, policyId: 'sla_1', kind, minutes }
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket_1',
    inboxId: 'inbox_1',
    primaryTeamId: 'team_1',
    priority: 'normal',
    slaPolicyId: 'sla_1',
    ...overrides,
  }
}

function clock(overrides: Record<string, unknown> = {}) {
  return {
    id: 'clock_1',
    ticketId: 'ticket_1',
    policyId: 'sla_1',
    targetId: 'target_resolution',
    kind: 'resolution',
    state: 'running',
    targetMinutes: 30,
    startedAt: new Date('2026-01-01T10:00:00.000Z'),
    pausedAt: null,
    accumulatedPausedMs: 0,
    dueAt: new Date('2026-01-01T10:30:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  hoisted.mockSelect.mockReset()
  hoisted.mockUpdate.mockReset()
  hoisted.mockInsert.mockReset()
  hoisted.mockBusinessHoursFindFirst.mockReset()
  hoisted.mockSlaPoliciesFindFirst.mockReset()
  hoisted.mockTicketSlaClocksFindFirst.mockReset()
  hoisted.mockWriteActivity.mockReset()
  hoisted.mockEq.mockReset()
  hoisted.mockAnd.mockReset()
  hoisted.mockOr.mockReset()
  hoisted.mockIsNull.mockReset()
  hoisted.mockAsc.mockReset()
  hoisted.mockInArray.mockReset()
  hoisted.mockSql.mockReset()
  hoisted.updateSets.length = 0
  hoisted.insertValues.length = 0
  hoisted.mockEq.mockImplementation((...args: unknown[]) => ['eq', ...args])
  hoisted.mockAnd.mockImplementation((...args: unknown[]) => ['and', ...args])
  hoisted.mockOr.mockImplementation((...args: unknown[]) => ['or', ...args])
  hoisted.mockIsNull.mockImplementation((...args: unknown[]) => ['isNull', ...args])
  hoisted.mockAsc.mockImplementation((...args: unknown[]) => ['asc', ...args])
  hoisted.mockInArray.mockImplementation((...args: unknown[]) => ['inArray', ...args])
  hoisted.mockSql.mockImplementation((...args: unknown[]) => ['sql', ...args])
  hoisted.mockUpdate.mockImplementation(() => makeUpdateChain())
  hoisted.mockWriteActivity.mockResolvedValue({ id: 'activity_1' })
})

describe('selectPolicyForTicket', () => {
  it('prefers matching inbox policies over team and workspace policies after priority filtering', async () => {
    hoisted.mockSelect.mockReturnValueOnce(
      makeSelectChain([
        policy({ id: 'sla_workspace_low_only', appliesToPriorities: ['low'] }),
        policy({ id: 'sla_team', scope: 'team', scopeTeamId: 'team_1' }),
        policy({ id: 'sla_inbox', scope: 'inbox', scopeInboxId: 'inbox_1' }),
      ])
    )

    const result = await engine.selectPolicyForTicket({
      inboxId: 'inbox_1' as never,
      primaryTeamId: 'team_1' as never,
      priority: 'normal',
    })

    expect(result?.id).toBe('sla_inbox')
  })

  it('returns null when no candidate applies and builds false scope predicates for null resources', async () => {
    hoisted.mockSelect.mockReturnValueOnce(
      makeSelectChain([policy({ id: 'urgent_only', appliesToPriorities: ['urgent'] })])
    )

    const result = await engine.selectPolicyForTicket({
      inboxId: null,
      primaryTeamId: null,
      priority: 'normal',
    })

    expect(result).toBeNull()
    expect(hoisted.mockSql).toHaveBeenCalled()
  })
})

describe('attachClocksOnCreate', () => {
  it('assigns the selected policy and starts first-response and resolution clocks', async () => {
    const selectedPolicy = policy({
      id: 'sla_1',
      name: 'Selected',
      scope: 'workspace',
      businessHoursId: 'bh_1',
    })
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([selectedPolicy]))
      .mockReturnValueOnce(
        makeSelectChain([target('first_response', 10), target('resolution', 60)])
      )
    hoisted.mockBusinessHoursFindFirst.mockResolvedValueOnce({
      timezone: 'UTC',
      schedule: {
        mon: [{ start: '09:00', end: '17:00' }],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      },
    })
    hoisted.mockTicketSlaClocksFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    hoisted.mockInsert
      .mockReturnValueOnce(makeInsertChain([clock({ id: 'clock_first', kind: 'first_response' })]))
      .mockReturnValueOnce(makeInsertChain([clock({ id: 'clock_resolution' })]))

    const result = await engine.attachClocksOnCreate(
      ticket({ slaPolicyId: null }) as never,
      'principal_agent' as never
    )

    expect(result.policy?.id).toBe('sla_1')
    expect(result.started.map((row) => row.id)).toEqual(['clock_first', 'clock_resolution'])
    expect(hoisted.updateSets).toContainEqual({ slaPolicyId: 'sla_1' })
    expect(hoisted.mockWriteActivity).toHaveBeenCalledWith(
      'ticket_1',
      'principal_agent',
      'sla.policy_assigned',
      expect.objectContaining({ policyId: 'sla_1', policyName: 'Selected' })
    )
    expect(hoisted.insertValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'first_response', targetMinutes: 10 }),
        expect.objectContaining({ kind: 'resolution', targetMinutes: 60 }),
      ])
    )
  })

  it('returns an empty start set when no policy matches', async () => {
    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain([]))

    await expect(engine.attachClocksOnCreate(ticket() as never, null)).resolves.toEqual({
      policy: null,
      started: [],
    })
    expect(hoisted.mockInsert).not.toHaveBeenCalled()
  })

  it('reuses an already active clock instead of inserting a duplicate', async () => {
    hoisted.mockSelect
      .mockReturnValueOnce(makeSelectChain([policy({ id: 'sla_1' })]))
      .mockReturnValueOnce(makeSelectChain([target('first_response', 10)]))
    const existingClock = clock({ id: 'clock_existing', kind: 'first_response' })
    hoisted.mockTicketSlaClocksFindFirst.mockResolvedValueOnce(existingClock)

    const result = await engine.attachClocksOnCreate(ticket() as never, null)

    expect(result.started).toEqual([existingClock])
    expect(hoisted.mockInsert).not.toHaveBeenCalled()
  })

  it('falls back to 24/7 clock math when the policy business-hours row is missing', async () => {
    hoisted.mockSelect
      .mockReturnValueOnce(
        makeSelectChain([policy({ id: 'sla_1', businessHoursId: 'bh_missing' })])
      )
      .mockReturnValueOnce(makeSelectChain([target('first_response', 20)]))
    hoisted.mockBusinessHoursFindFirst.mockResolvedValueOnce(null)
    hoisted.mockTicketSlaClocksFindFirst.mockResolvedValueOnce(null)
    hoisted.mockInsert.mockReturnValueOnce(
      makeInsertChain([clock({ id: 'clock_first', kind: 'first_response' })])
    )

    const result = await engine.attachClocksOnCreate(ticket() as never, null)

    expect(result.started).toHaveLength(1)
    expect(hoisted.insertValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'first_response' })])
    )
  })
})

describe('reply hooks', () => {
  it('marks first and next response clocks as met on public agent replies', async () => {
    hoisted.mockTicketSlaClocksFindFirst
      .mockResolvedValueOnce(clock({ id: 'clock_first', kind: 'first_response' }))
      .mockResolvedValueOnce(clock({ id: 'clock_next', kind: 'next_response' }))

    await engine.onPublicAgentReply(ticket() as never, 'principal_agent' as never)

    expect(hoisted.updateSets).toEqual([
      expect.objectContaining({ state: 'met', metAt: expect.any(Date) }),
      expect.objectContaining({ state: 'met', metAt: expect.any(Date) }),
    ])
    expect(hoisted.mockWriteActivity).toHaveBeenCalledWith(
      'ticket_1',
      'principal_agent',
      'sla.met',
      { clockId: 'clock_first', kind: 'first_response' }
    )
    expect(hoisted.mockWriteActivity).toHaveBeenCalledWith(
      'ticket_1',
      'principal_agent',
      'sla.met',
      { clockId: 'clock_next', kind: 'next_response' }
    )
  })

  it('leaves reply clocks unchanged when no active first or next response clock exists', async () => {
    hoisted.mockTicketSlaClocksFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    await engine.onPublicAgentReply(ticket() as never, 'principal_agent' as never)

    expect(hoisted.updateSets).toEqual([])
    expect(hoisted.mockWriteActivity).not.toHaveBeenCalled()
  })

  it('restarts a next-response clock on customer replies and noops without policy or target', async () => {
    await engine.onCustomerReply(ticket({ slaPolicyId: null }) as never, null)
    expect(hoisted.mockSlaPoliciesFindFirst).not.toHaveBeenCalled()

    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(null)
    await engine.onCustomerReply(ticket() as never, null)
    expect(hoisted.mockSelect).not.toHaveBeenCalled()

    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(policy({ id: 'sla_1' }))
    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain([]))
    await engine.onCustomerReply(ticket() as never, null)
    expect(hoisted.mockInsert).not.toHaveBeenCalled()

    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(policy({ id: 'sla_1' }))
    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain([target('next_response', 15)]))
    hoisted.mockTicketSlaClocksFindFirst.mockResolvedValueOnce(null)
    hoisted.mockInsert.mockReturnValueOnce(
      makeInsertChain([clock({ id: 'clock_next', kind: 'next_response' })])
    )

    await engine.onCustomerReply(ticket() as never, 'principal_customer' as never)

    expect(hoisted.updateSets).toContainEqual({ state: 'cancelled' })
    expect(hoisted.insertValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'next_response', targetMinutes: 15 }),
      ])
    )
  })
})

describe('status transition hook', () => {
  it('pauses running clocks when entering a pausing status', async () => {
    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(
      policy({ id: 'sla_1', pauseOnPending: true })
    )
    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain([clock({ id: 'clock_running' })]))

    await engine.onStatusTransition(
      ticket() as never,
      'open',
      'pending',
      'principal_agent' as never
    )

    expect(hoisted.updateSets).toContainEqual(
      expect.objectContaining({ state: 'paused', pausedAt: expect.any(Date) })
    )
    expect(hoisted.mockWriteActivity).toHaveBeenCalledWith(
      'ticket_1',
      'principal_agent',
      'sla.paused',
      expect.objectContaining({ clockId: 'clock_running', reason: 'pending' })
    )
  })

  it('pauses from a null previous category when entering on-hold', async () => {
    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(
      policy({ id: 'sla_1', pauseOnOnHold: true })
    )
    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain([clock({ id: 'clock_hold' })]))

    await engine.onStatusTransition(ticket() as never, null, 'on_hold', null)

    expect(hoisted.updateSets).toContainEqual(
      expect.objectContaining({ state: 'paused', pausedAt: expect.any(Date) })
    )
  })

  it('resumes paused clocks and shifts due dates when leaving a pausing status', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:30:00.000Z'))
    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(
      policy({ id: 'sla_1', pauseOnPending: true })
    )
    hoisted.mockSelect.mockReturnValueOnce(
      makeSelectChain([
        clock({
          id: 'clock_paused',
          state: 'paused',
          targetMinutes: 60,
          startedAt: new Date('2026-01-01T09:00:00.000Z'),
          pausedAt: new Date('2026-01-01T09:30:00.000Z'),
          accumulatedPausedMs: 1_000,
        }),
      ])
    )

    await engine.onStatusTransition(
      ticket() as never,
      'pending',
      'open',
      'principal_agent' as never
    )

    expect(hoisted.updateSets).toContainEqual(
      expect.objectContaining({
        state: 'running',
        pausedAt: null,
        accumulatedPausedMs: 3_601_000,
        dueAt: expect.any(Date),
      })
    )
    expect(hoisted.mockWriteActivity).toHaveBeenCalledWith(
      'ticket_1',
      'principal_agent',
      'sla.resumed',
      expect.objectContaining({ clockId: 'clock_paused', pausedMs: 3_600_000 })
    )
    vi.useRealTimers()
  })

  it('resumes clocks with null pause metadata using minimum remaining time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:30:00.000Z'))
    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(
      policy({ id: 'sla_1', pauseOnOnHold: true })
    )
    hoisted.mockSelect.mockReturnValueOnce(
      makeSelectChain([
        clock({
          id: 'clock_paused_nulls',
          state: 'paused',
          targetMinutes: 1,
          startedAt: new Date('2026-01-01T09:00:00.000Z'),
          pausedAt: null,
          accumulatedPausedMs: null,
        }),
      ])
    )

    await engine.onStatusTransition(ticket() as never, 'on_hold', 'open', null)

    expect(hoisted.updateSets).toContainEqual(
      expect.objectContaining({
        state: 'running',
        pausedAt: null,
        accumulatedPausedMs: 0,
        dueAt: expect.any(Date),
      })
    )
    vi.useRealTimers()
  })

  it('marks resolution met on solved, cancels active clocks on closed, and restarts resolution on reopen', async () => {
    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(policy({ id: 'sla_1' }))
    hoisted.mockTicketSlaClocksFindFirst.mockResolvedValueOnce(clock({ id: 'clock_resolution' }))
    await engine.onStatusTransition(ticket() as never, 'open', 'solved', 'principal_agent' as never)
    expect(hoisted.updateSets).toContainEqual(
      expect.objectContaining({ state: 'met', metAt: expect.any(Date) })
    )

    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(policy({ id: 'sla_1' }))
    hoisted.mockTicketSlaClocksFindFirst.mockResolvedValueOnce(null)
    await engine.onStatusTransition(ticket() as never, 'open', 'solved', null)
    expect(hoisted.updateSets.filter((set) => set.state === 'met')).toHaveLength(1)

    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(policy({ id: 'sla_1' }))
    hoisted.mockSelect.mockReturnValueOnce(
      makeSelectChain([
        clock({ id: 'clock_first', kind: 'first_response' }),
        clock({ id: 'clock_next', kind: 'next_response' }),
      ])
    )
    await engine.onStatusTransition(ticket() as never, 'solved', 'closed', null)
    expect(hoisted.updateSets.filter((set) => set.state === 'cancelled')).toHaveLength(2)

    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(policy({ id: 'sla_1' }))
    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain([target('resolution', 45)]))
    hoisted.mockTicketSlaClocksFindFirst.mockResolvedValueOnce(null)
    hoisted.mockInsert.mockReturnValueOnce(makeInsertChain([clock({ id: 'clock_reopened' })]))
    await engine.onStatusTransition(ticket() as never, 'solved', 'open', 'principal_agent' as never)
    expect(hoisted.insertValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'resolution', targetMinutes: 45 })])
    )

    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(policy({ id: 'sla_1' }))
    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain([]))
    await engine.onStatusTransition(ticket() as never, 'closed', 'open', null)
    expect(hoisted.insertValues.filter((value) => value.kind === 'resolution')).toHaveLength(1)
  })

  it('noops when the ticket is unbound or the stored policy is missing', async () => {
    await engine.onStatusTransition(ticket({ slaPolicyId: null }) as never, 'open', 'pending', null)
    expect(hoisted.mockSlaPoliciesFindFirst).not.toHaveBeenCalled()

    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(null)
    await engine.onStatusTransition(ticket() as never, 'open', 'pending', null)
    expect(hoisted.mockSelect).not.toHaveBeenCalled()
  })
})
