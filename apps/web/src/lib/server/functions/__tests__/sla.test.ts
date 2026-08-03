import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
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
  mockRecordEvent: vi.fn(),
  mockCreateBusinessHours: vi.fn(),
  mockUpdateBusinessHours: vi.fn(),
  mockArchiveBusinessHours: vi.fn(),
  mockGetBusinessHours: vi.fn(),
  mockListBusinessHours: vi.fn(),
  mockCreateSlaPolicy: vi.fn(),
  mockUpdateSlaPolicy: vi.fn(),
  mockArchiveSlaPolicy: vi.fn(),
  mockGetSlaPolicy: vi.fn(),
  mockListSlaPolicies: vi.fn(),
  mockReplaceTargets: vi.fn(),
  mockListTargetsForPolicy: vi.fn(),
  mockCreateEscalationRule: vi.fn(),
  mockUpdateEscalationRule: vi.fn(),
  mockDeleteEscalationRule: vi.fn(),
  mockListEscalationRulesForPolicy: vi.fn(),
  mockGetActiveClocksForTicket: vi.fn(),
  mockGetAllClocksForTicket: vi.fn(),
  mockListBreachingClocks: vi.fn(),
  mockRunEscalationTick: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requirePermission: (...args: unknown[]) => hoisted.mockRequirePermission(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: (...args: unknown[]) => hoisted.mockRecordEvent(...args),
}))

vi.mock('@/lib/server/domains/sla', () => ({
  createBusinessHours: (...args: unknown[]) => hoisted.mockCreateBusinessHours(...args),
  updateBusinessHours: (...args: unknown[]) => hoisted.mockUpdateBusinessHours(...args),
  archiveBusinessHours: (...args: unknown[]) => hoisted.mockArchiveBusinessHours(...args),
  getBusinessHours: (...args: unknown[]) => hoisted.mockGetBusinessHours(...args),
  listBusinessHours: (...args: unknown[]) => hoisted.mockListBusinessHours(...args),
  createSlaPolicy: (...args: unknown[]) => hoisted.mockCreateSlaPolicy(...args),
  updateSlaPolicy: (...args: unknown[]) => hoisted.mockUpdateSlaPolicy(...args),
  archiveSlaPolicy: (...args: unknown[]) => hoisted.mockArchiveSlaPolicy(...args),
  getSlaPolicy: (...args: unknown[]) => hoisted.mockGetSlaPolicy(...args),
  listSlaPolicies: (...args: unknown[]) => hoisted.mockListSlaPolicies(...args),
  replaceTargets: (...args: unknown[]) => hoisted.mockReplaceTargets(...args),
  listTargetsForPolicy: (...args: unknown[]) => hoisted.mockListTargetsForPolicy(...args),
  createEscalationRule: (...args: unknown[]) => hoisted.mockCreateEscalationRule(...args),
  updateEscalationRule: (...args: unknown[]) => hoisted.mockUpdateEscalationRule(...args),
  deleteEscalationRule: (...args: unknown[]) => hoisted.mockDeleteEscalationRule(...args),
  listEscalationRulesForPolicy: (...args: unknown[]) =>
    hoisted.mockListEscalationRulesForPolicy(...args),
  getActiveClocksForTicket: (...args: unknown[]) => hoisted.mockGetActiveClocksForTicket(...args),
  getAllClocksForTicket: (...args: unknown[]) => hoisted.mockGetAllClocksForTicket(...args),
  listBreachingClocks: (...args: unknown[]) => hoisted.mockListBreachingClocks(...args),
  runEscalationTick: (...args: unknown[]) => hoisted.mockRunEscalationTick(...args),
}))

vi.mock('@/lib/server/db', () => ({
  SLA_POLICY_SCOPES: ['workspace', 'team', 'inbox'],
  SLA_TARGET_KINDS: ['first_response', 'next_response', 'resolution'],
  ESCALATION_RECIPIENT_TYPES: ['assignee', 'team', 'principals', 'inbox_members'],
  ESCALATION_CHANNELS: ['in_app', 'email', 'webhook'],
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
}))

const PRINCIPAL = 'principal_admin' as PrincipalId

await import('../sla')

const [
  listBusinessHoursFn,
  getBusinessHoursFn,
  createBusinessHoursFn,
  updateBusinessHoursFn,
  archiveBusinessHoursFn,
  listSlaPoliciesFn,
  getSlaPolicyFn,
  createSlaPolicyFn,
  updateSlaPolicyFn,
  archiveSlaPolicyFn,
  replaceSlaTargetsFn,
  listEscalationRulesFn,
  createEscalationRuleFn,
  updateEscalationRuleFn,
  deleteEscalationRuleFn,
  getTicketSlaClocksFn,
  listBreachingClocksFn,
  runSlaTickFn,
] = handlersByIndex

if (!runSlaTickFn) {
  throw new Error(`SLA handlers were not registered; found ${handlersByIndex.length}`)
}

function businessHours(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bh_1',
    name: 'Weekdays',
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
    holidays: [],
    ...overrides,
  }
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sla_1',
    name: 'Default SLA',
    scope: 'workspace',
    enabled: true,
    ...overrides,
  }
}

function escalationRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'esc_1',
    policyId: 'sla_1',
    name: 'Warn',
    leadMinutes: 30,
    targetKind: 'resolution',
    recipientType: 'principals',
    recipientPrincipalIds: ['principal_1'],
    channels: ['in_app'],
    enabled: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequirePermission.mockResolvedValue({
    principal: { id: PRINCIPAL, role: 'admin' },
  })
  hoisted.mockRecordEvent.mockResolvedValue(undefined)
})

describe('SLA server functions — business hours', () => {
  it('lists and gets business hours after requiring view permission', async () => {
    const row = businessHours()
    hoisted.mockListBusinessHours.mockResolvedValue([row])
    hoisted.mockGetBusinessHours.mockResolvedValue(row)

    await expect(listBusinessHoursFn({ data: { includeArchived: true } })).resolves.toEqual([row])
    await expect(getBusinessHoursFn({ data: { id: 'bh_1' } })).resolves.toBe(row)

    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.SLA_VIEW)
    expect(hoisted.mockListBusinessHours).toHaveBeenCalledWith({ includeArchived: true })
    expect(hoisted.mockGetBusinessHours).toHaveBeenCalledWith('bh_1')
  })

  it('creates, updates, and archives business hours with manage permission and audit events', async () => {
    const row = businessHours({ name: 'Support hours' })
    hoisted.mockCreateBusinessHours.mockResolvedValue(row)
    hoisted.mockUpdateBusinessHours.mockResolvedValue(row)
    hoisted.mockArchiveBusinessHours.mockResolvedValue(row)

    await expect(
      createBusinessHoursFn({
        data: {
          name: 'Support hours',
          schedule: row.schedule,
          holidays: [{ date: '2026-01-01', label: 'NYD' }],
        },
      })
    ).resolves.toBe(row)
    expect(hoisted.mockCreateBusinessHours).toHaveBeenCalledWith({
      name: 'Support hours',
      schedule: row.schedule,
      holidays: [{ date: '2026-01-01', label: 'NYD' }],
    })

    await expect(
      updateBusinessHoursFn({ data: { id: 'bh_1', name: 'Updated', timezone: 'Europe/Berlin' } })
    ).resolves.toBe(row)
    expect(hoisted.mockUpdateBusinessHours).toHaveBeenCalledWith('bh_1', {
      name: 'Updated',
      timezone: 'Europe/Berlin',
    })

    await expect(archiveBusinessHoursFn({ data: { id: 'bh_1' } })).resolves.toBe(row)
    expect(hoisted.mockArchiveBusinessHours).toHaveBeenCalledWith('bh_1')
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.BUSINESS_HOURS_MANAGE)
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: PRINCIPAL,
        action: 'business_hours.created',
        targetType: 'business_hours',
        targetId: 'bh_1',
        diff: { after: { name: 'Support hours' } },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'business_hours.updated', targetId: 'bh_1' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'business_hours.archived', targetId: 'bh_1' })
    )
  })
})

describe('SLA server functions — policies', () => {
  it('lists policies and composes get-policy detail with targets and escalations', async () => {
    const row = policy()
    const targetRows = [{ id: 'target_1', kind: 'resolution' }]
    const escalationRows = [escalationRule()]
    hoisted.mockListSlaPolicies.mockResolvedValue([row])
    hoisted.mockGetSlaPolicy.mockResolvedValueOnce(null).mockResolvedValueOnce(row)
    hoisted.mockListTargetsForPolicy.mockResolvedValue(targetRows)
    hoisted.mockListEscalationRulesForPolicy.mockResolvedValue(escalationRows)

    await expect(listSlaPoliciesFn({ data: { includeArchived: false } })).resolves.toEqual([row])
    await expect(getSlaPolicyFn({ data: { id: 'sla_missing' } })).resolves.toBeNull()
    await expect(getSlaPolicyFn({ data: { id: 'sla_1' } })).resolves.toEqual({
      policy: row,
      targets: targetRows,
      escalations: escalationRows,
    })

    expect(hoisted.mockListSlaPolicies).toHaveBeenCalledWith({ includeArchived: false })
    expect(hoisted.mockListTargetsForPolicy).toHaveBeenCalledWith('sla_1')
    expect(hoisted.mockListEscalationRulesForPolicy).toHaveBeenCalledWith('sla_1')
  })

  it('creates, updates, archives, and replaces policy targets with audit events', async () => {
    const row = policy({ name: 'Inbox SLA', scope: 'inbox' })
    const targets = [{ id: 'target_1', kind: 'resolution' }]
    hoisted.mockCreateSlaPolicy.mockResolvedValue(row)
    hoisted.mockUpdateSlaPolicy.mockResolvedValue(row)
    hoisted.mockArchiveSlaPolicy.mockResolvedValue(row)
    hoisted.mockReplaceTargets.mockResolvedValue(targets)

    await expect(
      createSlaPolicyFn({
        data: {
          name: 'Inbox SLA',
          scope: 'inbox',
          scopeInboxId: 'inbox_1',
          appliesToPriorities: ['urgent'],
        },
      })
    ).resolves.toBe(row)
    expect(hoisted.mockCreateSlaPolicy).toHaveBeenCalledWith({
      name: 'Inbox SLA',
      scope: 'inbox',
      scopeInboxId: 'inbox_1',
      appliesToPriorities: ['urgent'],
    })

    await expect(
      updateSlaPolicyFn({ data: { id: 'sla_1', enabled: false, pauseOnPending: false } })
    ).resolves.toBe(row)
    expect(hoisted.mockUpdateSlaPolicy).toHaveBeenCalledWith('sla_1', {
      enabled: false,
      pauseOnPending: false,
    })

    await expect(archiveSlaPolicyFn({ data: { id: 'sla_1' } })).resolves.toBe(row)
    await expect(
      replaceSlaTargetsFn({
        data: { policyId: 'sla_1', targets: [{ kind: 'resolution', minutes: 60 }] },
      })
    ).resolves.toBe(targets)
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.SLA_MANAGE)
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sla_policy.created',
        targetId: 'sla_1',
        diff: { after: { name: 'Inbox SLA', scope: 'inbox' } },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sla_policy.targets_updated',
        diff: { after: { count: 1 } },
      })
    )
  })
})

describe('SLA server functions — escalation rules', () => {
  it('lists escalation rules with view permission and mutates them with manage permission', async () => {
    const row = escalationRule({ name: 'Warn agents' })
    hoisted.mockListEscalationRulesForPolicy.mockResolvedValue([row])
    hoisted.mockCreateEscalationRule.mockResolvedValue(row)
    hoisted.mockUpdateEscalationRule.mockResolvedValue(row)
    hoisted.mockDeleteEscalationRule.mockResolvedValue(undefined)

    await expect(listEscalationRulesFn({ data: { policyId: 'sla_1' } })).resolves.toEqual([row])
    await expect(
      createEscalationRuleFn({
        data: {
          policyId: 'sla_1',
          name: 'Warn agents',
          leadMinutes: 20,
          targetKind: 'resolution',
          recipientType: 'principals',
          recipientPrincipalIds: ['principal_1'],
          channels: ['in_app', 'email'],
        },
      })
    ).resolves.toBe(row)
    await expect(
      updateEscalationRuleFn({ data: { id: 'esc_1', leadMinutes: 10, enabled: false } })
    ).resolves.toBe(row)
    await expect(deleteEscalationRuleFn({ data: { id: 'esc_1' } })).resolves.toEqual({ ok: true })

    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.ESCALATION_RULE_MANAGE)
    expect(hoisted.mockCreateEscalationRule).toHaveBeenCalledWith({
      policyId: 'sla_1',
      name: 'Warn agents',
      leadMinutes: 20,
      targetKind: 'resolution',
      recipientType: 'principals',
      recipientPrincipalIds: ['principal_1'],
      channels: ['in_app', 'email'],
    })
    expect(hoisted.mockUpdateEscalationRule).toHaveBeenCalledWith('esc_1', {
      leadMinutes: 10,
      enabled: false,
    })
    expect(hoisted.mockDeleteEscalationRule).toHaveBeenCalledWith('esc_1')
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'escalation_rule.created',
        targetId: 'esc_1',
        diff: { after: { name: 'Warn agents', leadMinutes: 30 } },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'escalation_rule.deleted', targetId: 'esc_1' })
    )
  })
})

describe('SLA server functions — clocks and tick', () => {
  it('returns active or all ticket clocks based on includeAll', async () => {
    const active = [{ id: 'clock_active' }]
    const all = [{ id: 'clock_active' }, { id: 'clock_met' }]
    hoisted.mockGetActiveClocksForTicket.mockResolvedValue(active)
    hoisted.mockGetAllClocksForTicket.mockResolvedValue(all)

    await expect(
      getTicketSlaClocksFn({ data: { ticketId: 'ticket_1', includeAll: false } })
    ).resolves.toEqual(active)
    await expect(
      getTicketSlaClocksFn({ data: { ticketId: 'ticket_1', includeAll: true } })
    ).resolves.toEqual(all)

    expect(hoisted.mockGetActiveClocksForTicket).toHaveBeenCalledWith('ticket_1')
    expect(hoisted.mockGetAllClocksForTicket).toHaveBeenCalledWith('ticket_1')
  })

  it('lists breaching clocks and runs the escalation tick with the correct permissions', async () => {
    const breaching = [{ id: 'clock_due' }]
    hoisted.mockListBreachingClocks.mockResolvedValue(breaching)
    hoisted.mockRunEscalationTick.mockResolvedValue({ breached: 1, escalated: 2, considered: 3 })

    await expect(
      listBreachingClocksFn({ data: { windowMinutes: 30, limit: 10 } })
    ).resolves.toEqual(breaching)
    await expect(runSlaTickFn({ data: { batchSize: 50 } })).resolves.toEqual({
      breached: 1,
      escalated: 2,
      considered: 3,
    })

    expect(hoisted.mockListBreachingClocks).toHaveBeenCalledWith({
      windowMinutes: 30,
      limit: 10,
    })
    expect(hoisted.mockRunEscalationTick).toHaveBeenCalledWith({ batchSize: 50 })
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.SLA_VIEW)
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.SLA_MANAGE)
  })

  it('does not call domain services when permission checks reject', async () => {
    hoisted.mockRequirePermission.mockRejectedValueOnce(new Error('denied'))

    await expect(listBreachingClocksFn({ data: {} })).rejects.toThrow('denied')

    expect(hoisted.mockListBreachingClocks).not.toHaveBeenCalled()
  })
})
