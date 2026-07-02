import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockSelect: vi.fn(),
  mockTransaction: vi.fn(),
  mockBusinessHoursFindFirst: vi.fn(),
  mockSlaPoliciesFindFirst: vi.fn(),
  mockEscalationRulesFindFirst: vi.fn(),
  mockDispatchBusinessHoursCreated: vi.fn(),
  mockDispatchBusinessHoursUpdated: vi.fn(),
  mockDispatchBusinessHoursArchived: vi.fn(),
  mockDispatchSlaPolicyCreated: vi.fn(),
  mockDispatchSlaPolicyUpdated: vi.fn(),
  mockDispatchSlaPolicyArchived: vi.fn(),
  mockEq: vi.fn(),
  mockAnd: vi.fn(),
  mockIsNull: vi.fn(),
  mockAsc: vi.fn(),
  mockLte: vi.fn(),
  mockInArray: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...args: unknown[]) => hoisted.mockInsert(...args),
    update: (...args: unknown[]) => hoisted.mockUpdate(...args),
    delete: (...args: unknown[]) => hoisted.mockDelete(...args),
    select: (...args: unknown[]) => hoisted.mockSelect(...args),
    transaction: (...args: unknown[]) => hoisted.mockTransaction(...args),
    query: {
      businessHours: {
        findFirst: (...args: unknown[]) => hoisted.mockBusinessHoursFindFirst(...args),
      },
      slaPolicies: { findFirst: (...args: unknown[]) => hoisted.mockSlaPoliciesFindFirst(...args) },
      escalationRules: {
        findFirst: (...args: unknown[]) => hoisted.mockEscalationRulesFindFirst(...args),
      },
    },
  },
  businessHours: {
    _name: 'business_hours',
    id: 'businessHours.id',
    name: 'businessHours.name',
    archivedAt: 'businessHours.archivedAt',
  },
  slaPolicies: {
    _name: 'sla_policies',
    id: 'slaPolicies.id',
    priority: 'slaPolicies.priority',
    createdAt: 'slaPolicies.createdAt',
    archivedAt: 'slaPolicies.archivedAt',
  },
  slaTargets: {
    _name: 'sla_targets',
    policyId: 'slaTargets.policyId',
  },
  escalationRules: {
    _name: 'escalation_rules',
    id: 'escalationRules.id',
    policyId: 'escalationRules.policyId',
    leadMinutes: 'escalationRules.leadMinutes',
  },
  ticketSlaClocks: {
    _name: 'ticket_sla_clocks',
    ticketId: 'ticketSlaClocks.ticketId',
    state: 'ticketSlaClocks.state',
    dueAt: 'ticketSlaClocks.dueAt',
    createdAt: 'ticketSlaClocks.createdAt',
  },
  SLA_POLICY_SCOPES: ['workspace', 'team', 'inbox'],
  SLA_TARGET_KINDS: ['first_response', 'next_response', 'resolution'],
  ESCALATION_RECIPIENT_TYPES: ['assignee', 'team', 'principals', 'inbox_members'],
  ESCALATION_CHANNELS: ['in_app', 'email', 'webhook'],
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  eq: (...args: unknown[]) => hoisted.mockEq(...args),
  and: (...args: unknown[]) => hoisted.mockAnd(...args),
  isNull: (...args: unknown[]) => hoisted.mockIsNull(...args),
  asc: (...args: unknown[]) => hoisted.mockAsc(...args),
  lte: (...args: unknown[]) => hoisted.mockLte(...args),
  inArray: (...args: unknown[]) => hoisted.mockInArray(...args),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchBusinessHoursCreated: (...args: unknown[]) =>
    hoisted.mockDispatchBusinessHoursCreated(...args),
  dispatchBusinessHoursUpdated: (...args: unknown[]) =>
    hoisted.mockDispatchBusinessHoursUpdated(...args),
  dispatchBusinessHoursArchived: (...args: unknown[]) =>
    hoisted.mockDispatchBusinessHoursArchived(...args),
  dispatchSlaPolicyCreated: (...args: unknown[]) => hoisted.mockDispatchSlaPolicyCreated(...args),
  dispatchSlaPolicyUpdated: (...args: unknown[]) => hoisted.mockDispatchSlaPolicyUpdated(...args),
  dispatchSlaPolicyArchived: (...args: unknown[]) => hoisted.mockDispatchSlaPolicyArchived(...args),
}))

const businessHoursService = await import('../business-hours.service')
const policyService = await import('../sla.policies.service')
const queries = await import('../sla.queries')

type Chain = {
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  orderBy: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  then: Promise<unknown[]>['then']
  catch: Promise<unknown[]>['catch']
  finally: Promise<unknown[]>['finally']
}

function makeSelectChain(rows: unknown[]): Chain {
  const promise = Promise.resolve(rows)
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  } as Chain
  return chain
}

function makeInsertChain(rows: unknown[]) {
  return {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  }
}

function makeUpdateChain(rows: unknown[]) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  }
}

function makeDeleteChain() {
  const promise = Promise.resolve(undefined)
  const chain = {
    where: vi.fn(() => chain),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
  return chain
}

const schedule = {
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
  sat: [],
  sun: [],
}

function businessHoursRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bh_1',
    name: 'Weekdays',
    timezone: 'UTC',
    schedule,
    holidays: [],
    archivedAt: null,
    ...overrides,
  }
}

function policyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sla_1',
    name: 'Default SLA',
    description: null,
    priority: 100,
    enabled: true,
    scope: 'workspace',
    scopeTeamId: null,
    scopeInboxId: null,
    appliesToPriorities: [],
    businessHoursId: null,
    pauseOnPending: true,
    pauseOnOnHold: true,
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function escalationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'esc_1',
    policyId: 'sla_1',
    name: 'Warn owners',
    leadMinutes: 30,
    targetKind: 'resolution',
    recipientType: 'principals',
    recipientTeamId: null,
    recipientPrincipalIds: ['principal_1'],
    channels: ['in_app'],
    enabled: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockEq.mockImplementation((...args: unknown[]) => ['eq', ...args])
  hoisted.mockAnd.mockImplementation((...args: unknown[]) => ['and', ...args])
  hoisted.mockIsNull.mockImplementation((...args: unknown[]) => ['isNull', ...args])
  hoisted.mockAsc.mockImplementation((...args: unknown[]) => ['asc', ...args])
  hoisted.mockLte.mockImplementation((...args: unknown[]) => ['lte', ...args])
  hoisted.mockInArray.mockImplementation((...args: unknown[]) => ['inArray', ...args])
  hoisted.mockDispatchBusinessHoursCreated.mockResolvedValue(undefined)
  hoisted.mockDispatchBusinessHoursUpdated.mockResolvedValue(undefined)
  hoisted.mockDispatchBusinessHoursArchived.mockResolvedValue(undefined)
  hoisted.mockDispatchSlaPolicyCreated.mockResolvedValue(undefined)
  hoisted.mockDispatchSlaPolicyUpdated.mockResolvedValue(undefined)
  hoisted.mockDispatchSlaPolicyArchived.mockResolvedValue(undefined)
  hoisted.mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      delete: hoisted.mockDelete,
      insert: hoisted.mockInsert,
    })
  )
})

describe('business-hours service', () => {
  it('creates business hours with normalized name, defaults, and an event ref', async () => {
    const insertChain = makeInsertChain([businessHoursRow({ name: 'Support hours' })])
    hoisted.mockInsert.mockReturnValueOnce(insertChain)

    const result = await businessHoursService.createBusinessHours({
      name: '  Support hours  ',
      schedule,
    })

    expect(result.name).toBe('Support hours')
    expect(insertChain.values).toHaveBeenCalledWith({
      name: 'Support hours',
      timezone: 'UTC',
      schedule,
      holidays: [],
    })
    expect(hoisted.mockDispatchBusinessHoursCreated).toHaveBeenCalledWith(
      { type: 'service', displayName: 'business-hours-system' },
      expect.objectContaining({ id: 'bh_1', name: 'Support hours', archivedAt: null })
    )
  })

  it('rejects invalid business-hours input before writing', async () => {
    await expect(
      businessHoursService.createBusinessHours({ name: ' ', schedule })
    ).rejects.toMatchObject({ code: 'BUSINESS_HOURS_NAME_REQUIRED' })
    await expect(
      businessHoursService.createBusinessHours({ name: 'x'.repeat(201), schedule })
    ).rejects.toMatchObject({ code: 'BUSINESS_HOURS_NAME_TOO_LONG' })
    await expect(
      businessHoursService.createBusinessHours({
        name: 'Bad tz',
        timezone: 'Not/AZone',
        schedule,
      })
    ).rejects.toMatchObject({ code: 'BUSINESS_HOURS_TZ_INVALID' })
    await expect(
      businessHoursService.createBusinessHours({
        name: 'Bad schedule',
        schedule: { ...schedule, mon: [{ start: '17:00', end: '09:00' }] },
      })
    ).rejects.toMatchObject({ code: 'BUSINESS_HOURS_SCHEDULE_INVALID' })
    await expect(
      businessHoursService.createBusinessHours({
        name: 'Bad holiday',
        schedule,
        holidays: [{ date: '2026-99-99' }],
      })
    ).rejects.toMatchObject({ code: 'BUSINESS_HOURS_HOLIDAYS_INVALID' })
    expect(hoisted.mockInsert).not.toHaveBeenCalled()
  })

  it('updates only provided business-hours fields and rejects missing or archived rows', async () => {
    hoisted.mockBusinessHoursFindFirst.mockResolvedValueOnce(null)
    await expect(
      businessHoursService.updateBusinessHours('bh_missing' as never, { name: 'Nope' })
    ).rejects.toMatchObject({ code: 'BUSINESS_HOURS_NOT_FOUND' })

    hoisted.mockBusinessHoursFindFirst.mockResolvedValueOnce(
      businessHoursRow({ archivedAt: new Date('2026-02-01T00:00:00.000Z') })
    )
    await expect(
      businessHoursService.updateBusinessHours('bh_1' as never, { name: 'Archived' })
    ).rejects.toMatchObject({ code: 'BUSINESS_HOURS_ARCHIVED' })

    const existing = businessHoursRow()
    hoisted.mockBusinessHoursFindFirst.mockResolvedValueOnce(existing)
    await expect(businessHoursService.updateBusinessHours('bh_1' as never, {})).resolves.toBe(
      existing
    )

    const updateChain = makeUpdateChain([
      businessHoursRow({ name: 'Updated', timezone: 'Europe/Berlin' }),
    ])
    hoisted.mockBusinessHoursFindFirst.mockResolvedValueOnce(existing)
    hoisted.mockUpdate.mockReturnValueOnce(updateChain)

    const result = await businessHoursService.updateBusinessHours('bh_1' as never, {
      name: ' Updated ',
      timezone: 'Europe/Berlin',
      schedule: { ...schedule, sat: [{ start: '10:00', end: '12:00' }] },
      holidays: [{ date: '2026-01-01', label: 'NYD' }],
    })

    expect(result.name).toBe('Updated')
    expect(updateChain.set).toHaveBeenCalledWith({
      name: 'Updated',
      timezone: 'Europe/Berlin',
      schedule: { ...schedule, sat: [{ start: '10:00', end: '12:00' }] },
      holidays: [{ date: '2026-01-01', label: 'NYD' }],
    })
    expect(hoisted.mockDispatchBusinessHoursUpdated).toHaveBeenCalledWith(
      { type: 'service', displayName: 'business-hours-system' },
      expect.objectContaining({ id: 'bh_1', name: 'Updated' }),
      ['name', 'timezone', 'schedule', 'holidays']
    )
  })

  it('archives, gets, and lists business hours', async () => {
    const archived = businessHoursRow({ archivedAt: new Date('2026-02-01T00:00:00.000Z') })
    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([archived]))
    await expect(businessHoursService.archiveBusinessHours('bh_1' as never)).resolves.toBe(archived)

    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([]))
    await expect(
      businessHoursService.archiveBusinessHours('bh_missing' as never)
    ).rejects.toMatchObject({ code: 'BUSINESS_HOURS_NOT_FOUND' })

    hoisted.mockBusinessHoursFindFirst.mockResolvedValueOnce(undefined)
    await expect(businessHoursService.getBusinessHours('bh_missing' as never)).resolves.toBeNull()

    const rows = [businessHoursRow()]
    const selectChain = makeSelectChain(rows)
    hoisted.mockSelect.mockReturnValueOnce(selectChain)
    await expect(businessHoursService.listBusinessHours()).resolves.toEqual(rows)
    expect(selectChain.where).toHaveBeenCalledWith(['isNull', 'businessHours.archivedAt'])

    const archivedSelect = makeSelectChain([archived])
    hoisted.mockSelect.mockReturnValueOnce(archivedSelect)
    await expect(
      businessHoursService.listBusinessHours({ includeArchived: true })
    ).resolves.toEqual([archived])
    expect(archivedSelect.where).toHaveBeenCalledWith(undefined)
  })
})

describe('SLA policy service', () => {
  it('creates policies with scope validation, defaults, and event refs', async () => {
    const insertChain = makeInsertChain([
      policyRow({ name: 'Team SLA', scope: 'team', scopeTeamId: 'team_1' }),
    ])
    hoisted.mockInsert.mockReturnValueOnce(insertChain)

    const result = await policyService.createSlaPolicy({
      name: ' Team SLA ',
      scope: 'team',
      scopeTeamId: 'team_1' as never,
    })

    expect(result.name).toBe('Team SLA')
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Team SLA',
        priority: 100,
        enabled: true,
        scope: 'team',
        scopeTeamId: 'team_1',
        scopeInboxId: null,
        appliesToPriorities: [],
        pauseOnPending: true,
        pauseOnOnHold: true,
      })
    )
    expect(hoisted.mockDispatchSlaPolicyCreated).toHaveBeenCalledWith(
      { type: 'service', displayName: 'sla-system' },
      expect.objectContaining({ id: 'sla_1', name: 'Team SLA', scope: 'team' })
    )
  })

  it('rejects invalid policy names and scope bindings', async () => {
    await expect(
      policyService.createSlaPolicy({ name: '', scope: 'workspace' })
    ).rejects.toMatchObject({
      code: 'SLA_POLICY_NAME_REQUIRED',
    })
    await expect(
      policyService.createSlaPolicy({ name: 'x'.repeat(201), scope: 'workspace' })
    ).rejects.toMatchObject({ code: 'SLA_POLICY_NAME_TOO_LONG' })
    await expect(
      policyService.createSlaPolicy({ name: 'Bad', scope: 'bogus' as never })
    ).rejects.toMatchObject({ code: 'SLA_POLICY_SCOPE_INVALID' })
    await expect(
      policyService.createSlaPolicy({ name: 'Team', scope: 'team' })
    ).rejects.toMatchObject({ code: 'SLA_POLICY_SCOPE_TEAM_REQUIRED' })
    await expect(
      policyService.createSlaPolicy({ name: 'Inbox', scope: 'inbox' })
    ).rejects.toMatchObject({ code: 'SLA_POLICY_SCOPE_INBOX_REQUIRED' })
    await expect(
      policyService.createSlaPolicy({
        name: 'Workspace',
        scope: 'workspace',
        scopeTeamId: 'team_1' as never,
      })
    ).rejects.toMatchObject({ code: 'SLA_POLICY_SCOPE_WORKSPACE_NO_BIND' })
    await expect(
      policyService.createSlaPolicy({
        name: 'Workspace',
        scope: 'workspace',
        scopeInboxId: 'inbox_1' as never,
      })
    ).rejects.toMatchObject({ code: 'SLA_POLICY_SCOPE_WORKSPACE_NO_BIND' })
  })

  it('updates, archives, gets, and lists policies', async () => {
    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(null)
    await expect(
      policyService.updateSlaPolicy('sla_missing' as never, { name: 'Missing' })
    ).rejects.toMatchObject({ code: 'SLA_POLICY_NOT_FOUND' })

    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(
      policyRow({ archivedAt: new Date('2026-01-01T00:00:00.000Z') })
    )
    await expect(
      policyService.updateSlaPolicy('sla_1' as never, { enabled: false })
    ).rejects.toMatchObject({ code: 'SLA_POLICY_ARCHIVED' })

    const existing = policyRow()
    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(existing)
    await expect(policyService.updateSlaPolicy('sla_1' as never, {})).resolves.toBe(existing)

    const updateChain = makeUpdateChain([
      policyRow({
        name: 'Updated SLA',
        description: 'desc',
        priority: 5,
        enabled: false,
        appliesToPriorities: ['urgent'],
        businessHoursId: 'bh_1',
        pauseOnPending: false,
        pauseOnOnHold: false,
      }),
    ])
    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(existing)
    hoisted.mockUpdate.mockReturnValueOnce(updateChain)

    await policyService.updateSlaPolicy('sla_1' as never, {
      name: ' Updated SLA ',
      description: 'desc',
      priority: 5,
      enabled: false,
      appliesToPriorities: ['urgent'],
      businessHoursId: 'bh_1' as never,
      pauseOnPending: false,
      pauseOnOnHold: false,
    })

    expect(updateChain.set).toHaveBeenCalledWith({
      name: 'Updated SLA',
      description: 'desc',
      priority: 5,
      enabled: false,
      appliesToPriorities: ['urgent'],
      businessHoursId: 'bh_1',
      pauseOnPending: false,
      pauseOnOnHold: false,
    })
    expect(hoisted.mockDispatchSlaPolicyUpdated).toHaveBeenCalledWith(
      { type: 'service', displayName: 'sla-system' },
      expect.objectContaining({ id: 'sla_1', name: 'Updated SLA' }),
      [
        'name',
        'description',
        'priority',
        'enabled',
        'appliesToPriorities',
        'businessHoursId',
        'pauseOnPending',
        'pauseOnOnHold',
      ]
    )

    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([policyRow({ archivedAt: new Date() })]))
    await expect(policyService.archiveSlaPolicy('sla_1' as never)).resolves.toMatchObject({
      id: 'sla_1',
    })
    hoisted.mockUpdate.mockReturnValueOnce(makeUpdateChain([]))
    await expect(policyService.archiveSlaPolicy('sla_missing' as never)).rejects.toMatchObject({
      code: 'SLA_POLICY_NOT_FOUND',
    })

    hoisted.mockSlaPoliciesFindFirst.mockResolvedValueOnce(undefined)
    await expect(policyService.getSlaPolicy('sla_missing' as never)).resolves.toBeNull()

    const selectChain = makeSelectChain([policyRow()])
    hoisted.mockSelect.mockReturnValueOnce(selectChain)
    await expect(policyService.listSlaPolicies()).resolves.toHaveLength(1)
    expect(selectChain.where).toHaveBeenCalledWith(['isNull', 'slaPolicies.archivedAt'])

    const archivedSelect = makeSelectChain([policyRow({ archivedAt: new Date() })])
    hoisted.mockSelect.mockReturnValueOnce(archivedSelect)
    await expect(policyService.listSlaPolicies({ includeArchived: true })).resolves.toHaveLength(1)
    expect(archivedSelect.where).toHaveBeenCalledWith(undefined)
  })

  it('replaces targets atomically, deduplicating by kind and validating inputs', async () => {
    await expect(
      policyService.replaceTargets('sla_1' as never, [{ kind: 'bad' as never, minutes: 10 }])
    ).rejects.toMatchObject({ code: 'SLA_TARGET_KIND_INVALID' })
    await expect(
      policyService.replaceTargets('sla_1' as never, [{ kind: 'resolution', minutes: 0 }])
    ).rejects.toMatchObject({ code: 'SLA_TARGET_MINUTES_INVALID' })

    const deleteChain = makeDeleteChain()
    const insertChain = makeInsertChain([
      { id: 'target_1', kind: 'resolution', minutes: 45 },
      { id: 'target_2', kind: 'first_response', minutes: 10 },
    ])
    hoisted.mockDelete.mockReturnValue(deleteChain)
    hoisted.mockInsert.mockReturnValueOnce(insertChain)

    const rows = await policyService.replaceTargets('sla_1' as never, [
      { kind: 'resolution', minutes: 30 },
      { kind: 'resolution', minutes: 45 },
      { kind: 'first_response', minutes: 10 },
    ])

    expect(rows).toHaveLength(2)
    expect(insertChain.values).toHaveBeenCalledWith([
      { policyId: 'sla_1', kind: 'resolution', minutes: 45 },
      { policyId: 'sla_1', kind: 'first_response', minutes: 10 },
    ])

    hoisted.mockDelete.mockReturnValueOnce(makeDeleteChain())
    await expect(policyService.replaceTargets('sla_1' as never, [])).resolves.toEqual([])
  })

  it('lists targets and validates escalation rules', async () => {
    const targets = [{ id: 'target_1', kind: 'resolution' }]
    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain(targets))
    await expect(policyService.listTargetsForPolicy('sla_1' as never)).resolves.toEqual(targets)

    await expect(
      policyService.createEscalationRule({
        policyId: 'sla_1' as never,
        name: 'Bad target',
        leadMinutes: 5,
        targetKind: 'bad' as never,
        recipientType: 'assignee',
      })
    ).rejects.toMatchObject({ code: 'ESCALATION_TARGET_KIND_INVALID' })
    await expect(
      policyService.createEscalationRule({
        policyId: 'sla_1' as never,
        name: 'Bad recipient',
        leadMinutes: 5,
        targetKind: 'resolution',
        recipientType: 'bad' as never,
      })
    ).rejects.toMatchObject({ code: 'ESCALATION_RECIPIENT_TYPE_INVALID' })
    await expect(
      policyService.createEscalationRule({
        policyId: 'sla_1' as never,
        name: 'Missing team',
        leadMinutes: 5,
        targetKind: 'resolution',
        recipientType: 'team',
      })
    ).rejects.toMatchObject({ code: 'ESCALATION_RECIPIENT_TEAM_REQUIRED' })
    await expect(
      policyService.createEscalationRule({
        policyId: 'sla_1' as never,
        name: 'Missing principals',
        leadMinutes: 5,
        targetKind: 'resolution',
        recipientType: 'principals',
      })
    ).rejects.toMatchObject({ code: 'ESCALATION_RECIPIENT_PRINCIPALS_REQUIRED' })
    await expect(
      policyService.createEscalationRule({
        policyId: 'sla_1' as never,
        name: 'Empty principals',
        leadMinutes: 5,
        targetKind: 'resolution',
        recipientType: 'principals',
        recipientPrincipalIds: [],
      })
    ).rejects.toMatchObject({ code: 'ESCALATION_RECIPIENT_PRINCIPALS_REQUIRED' })
    await expect(
      policyService.createEscalationRule({
        policyId: 'sla_1' as never,
        name: 'Bad channel',
        leadMinutes: 5,
        targetKind: 'resolution',
        recipientType: 'assignee',
        channels: ['sms' as never],
      })
    ).rejects.toMatchObject({ code: 'ESCALATION_CHANNEL_INVALID' })
    await expect(
      policyService.createEscalationRule({
        policyId: 'sla_1' as never,
        name: 'Bad lead',
        leadMinutes: Number.NaN,
        targetKind: 'resolution',
        recipientType: 'assignee',
      })
    ).rejects.toMatchObject({ code: 'ESCALATION_LEAD_MINUTES_INVALID' })
  })

  it('creates, updates, deletes, and lists escalation rules', async () => {
    const insertChain = makeInsertChain([escalationRow({ channels: ['in_app'], enabled: true })])
    hoisted.mockInsert.mockReturnValueOnce(insertChain)
    await policyService.createEscalationRule({
      policyId: 'sla_1' as never,
      name: ' Warn owners ',
      leadMinutes: 30,
      targetKind: 'resolution',
      recipientType: 'principals',
      recipientPrincipalIds: ['principal_1' as never],
    })
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Warn owners',
        channels: ['in_app'],
        enabled: true,
      })
    )

    const assigneeInsertChain = makeInsertChain([escalationRow({ recipientType: 'assignee' })])
    hoisted.mockInsert.mockReturnValueOnce(assigneeInsertChain)
    await policyService.createEscalationRule({
      policyId: 'sla_1' as never,
      name: 'Warn assignee',
      leadMinutes: 15,
      targetKind: 'resolution',
      recipientType: 'assignee',
    })
    expect(assigneeInsertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientPrincipalIds: [],
        recipientTeamId: null,
      })
    )

    hoisted.mockEscalationRulesFindFirst.mockResolvedValueOnce(null)
    await expect(
      policyService.updateEscalationRule('esc_missing' as never, { name: 'Missing' })
    ).rejects.toMatchObject({ code: 'ESCALATION_RULE_NOT_FOUND' })

    const existing = escalationRow()
    hoisted.mockEscalationRulesFindFirst.mockResolvedValueOnce(existing)
    await expect(policyService.updateEscalationRule('esc_1' as never, {})).resolves.toBe(existing)

    const updateChain = makeUpdateChain([
      escalationRow({
        name: 'Updated',
        leadMinutes: 10,
        targetKind: 'first_response',
        recipientType: 'team',
        recipientTeamId: 'team_1',
        recipientPrincipalIds: ['principal_2'],
        channels: ['email'],
        enabled: false,
      }),
    ])
    hoisted.mockEscalationRulesFindFirst.mockResolvedValueOnce(existing)
    hoisted.mockUpdate.mockReturnValueOnce(updateChain)

    await policyService.updateEscalationRule('esc_1' as never, {
      name: 'Updated',
      leadMinutes: 10,
      targetKind: 'first_response',
      recipientType: 'team',
      recipientTeamId: 'team_1' as never,
      recipientPrincipalIds: ['principal_2' as never],
      channels: ['email'],
      enabled: false,
    })

    expect(updateChain.set).toHaveBeenCalledWith({
      name: 'Updated',
      leadMinutes: 10,
      targetKind: 'first_response',
      recipientType: 'team',
      recipientTeamId: 'team_1',
      recipientPrincipalIds: ['principal_2'],
      channels: ['email'],
      enabled: false,
    })

    const deleteChain = makeDeleteChain()
    hoisted.mockDelete.mockReturnValueOnce(deleteChain)
    await policyService.deleteEscalationRule('esc_1' as never)
    expect(deleteChain.where).toHaveBeenCalled()

    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain([escalationRow()]))
    await expect(
      policyService.listEscalationRulesForPolicy('sla_1' as never)
    ).resolves.toHaveLength(1)
  })
})

describe('SLA clock queries', () => {
  it('returns active, all, and breaching clocks with the expected query shape', async () => {
    const active = [{ id: 'clock_running', state: 'running' }]
    const all = [{ id: 'clock_met', state: 'met' }]
    const breaching = [{ id: 'clock_due', state: 'running' }]

    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain(active))
    await expect(queries.getActiveClocksForTicket('ticket_1' as never)).resolves.toEqual(active)
    expect(hoisted.mockInArray).toHaveBeenCalledWith('ticketSlaClocks.state', [
      'running',
      'paused',
      'breached',
    ])

    hoisted.mockSelect.mockReturnValueOnce(makeSelectChain(all))
    await expect(queries.getAllClocksForTicket('ticket_1' as never)).resolves.toEqual(all)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'))
    const selectChain = makeSelectChain(breaching)
    hoisted.mockSelect.mockReturnValueOnce(selectChain)
    await expect(queries.listBreachingClocks({ windowMinutes: 15, limit: 25 })).resolves.toEqual(
      breaching
    )
    expect(selectChain.limit).toHaveBeenCalledWith(25)
    const lteArgs = hoisted.mockLte.mock.calls.at(-1)
    expect(lteArgs?.[1]).toEqual(new Date('2026-03-01T12:15:00.000Z'))
    vi.useRealTimers()

    const defaultLimitChain = makeSelectChain([])
    hoisted.mockSelect.mockReturnValueOnce(defaultLimitChain)
    await queries.listBreachingClocks()
    expect(defaultLimitChain.limit).toHaveBeenCalledWith(200)
  })
})
