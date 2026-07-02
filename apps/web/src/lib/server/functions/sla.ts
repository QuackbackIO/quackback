/**
 * SLA server functions — admin/agent surface for SLA + escalation CRUD,
 * and a manual escalation tick trigger.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type {
  BusinessHoursId,
  SlaPolicyId,
  EscalationRuleId,
  TeamId,
  InboxId,
  PrincipalId,
  TicketId,
} from '@quackback/ids'
import { requirePermission } from './auth-helpers'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { recordEvent } from '@/lib/server/domains/audit'
import {
  createBusinessHours,
  updateBusinessHours,
  archiveBusinessHours,
  getBusinessHours,
  listBusinessHours,
  createSlaPolicy,
  updateSlaPolicy,
  archiveSlaPolicy,
  getSlaPolicy,
  listSlaPolicies,
  replaceTargets,
  listTargetsForPolicy,
  createEscalationRule,
  updateEscalationRule,
  deleteEscalationRule,
  listEscalationRulesForPolicy,
  getActiveClocksForTicket,
  getAllClocksForTicket,
  listBreachingClocks,
  runEscalationTick,
} from '@/lib/server/domains/sla'
import {
  SLA_POLICY_SCOPES,
  SLA_TARGET_KINDS,
  ESCALATION_RECIPIENT_TYPES,
  ESCALATION_CHANNELS,
  TICKET_PRIORITIES,
} from '@/lib/server/db'

const businessHoursIdSchema = z.string().min(1) as z.ZodType<BusinessHoursId>
const slaPolicyIdSchema = z.string().min(1) as z.ZodType<SlaPolicyId>
const escalationRuleIdSchema = z.string().min(1) as z.ZodType<EscalationRuleId>
const teamIdSchema = z.string().min(1) as z.ZodType<TeamId>
const inboxIdSchema = z.string().min(1) as z.ZodType<InboxId>
const principalIdSchema = z.string().min(1) as z.ZodType<PrincipalId>
const ticketIdSchema = z.string().min(1) as z.ZodType<TicketId>

const rangeSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
})
const scheduleSchema = z.object({
  mon: z.array(rangeSchema),
  tue: z.array(rangeSchema),
  wed: z.array(rangeSchema),
  thu: z.array(rangeSchema),
  fri: z.array(rangeSchema),
  sat: z.array(rangeSchema),
  sun: z.array(rangeSchema),
})
const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().max(200).optional(),
})

// ---- business hours ----

export const listBusinessHoursFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ includeArchived: z.boolean().optional() }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.SLA_VIEW)
    return listBusinessHours({ includeArchived: data.includeArchived })
  })

export const getBusinessHoursFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: businessHoursIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.SLA_VIEW)
    return getBusinessHours(data.id)
  })

export const createBusinessHoursFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().min(1).max(200),
      timezone: z.string().min(1).max(64).optional(),
      schedule: scheduleSchema,
      holidays: z.array(holidaySchema).optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.BUSINESS_HOURS_MANAGE)
    const row = await createBusinessHours(data)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'business_hours.created',
      targetType: 'business_hours',
      targetId: row.id,
      diff: { after: { name: row.name } },
    })
    return row
  })

export const updateBusinessHoursFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: businessHoursIdSchema,
      name: z.string().min(1).max(200).optional(),
      timezone: z.string().min(1).max(64).optional(),
      schedule: scheduleSchema.optional(),
      holidays: z.array(holidaySchema).optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.BUSINESS_HOURS_MANAGE)
    const { id, ...patch } = data
    const row = await updateBusinessHours(id, patch)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'business_hours.updated',
      targetType: 'business_hours',
      targetId: id,
    })
    return row
  })

export const archiveBusinessHoursFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: businessHoursIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.BUSINESS_HOURS_MANAGE)
    const row = await archiveBusinessHours(data.id)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'business_hours.archived',
      targetType: 'business_hours',
      targetId: data.id,
    })
    return row
  })

// ---- sla policies ----

export const listSlaPoliciesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ includeArchived: z.boolean().optional() }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.SLA_VIEW)
    return listSlaPolicies({ includeArchived: data.includeArchived })
  })

export const getSlaPolicyFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: slaPolicyIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.SLA_VIEW)
    const policy = await getSlaPolicy(data.id)
    if (!policy) return null
    const targets = await listTargetsForPolicy(data.id)
    const escalations = await listEscalationRulesForPolicy(data.id)
    return { policy, targets, escalations }
  })

export const createSlaPolicyFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).nullable().optional(),
      priority: z.number().int().optional(),
      enabled: z.boolean().optional(),
      scope: z.enum(SLA_POLICY_SCOPES),
      scopeTeamId: teamIdSchema.nullable().optional(),
      scopeInboxId: inboxIdSchema.nullable().optional(),
      appliesToPriorities: z.array(z.enum(TICKET_PRIORITIES)).optional(),
      businessHoursId: businessHoursIdSchema.nullable().optional(),
      pauseOnPending: z.boolean().optional(),
      pauseOnOnHold: z.boolean().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.SLA_MANAGE)
    const policy = await createSlaPolicy(data)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'sla_policy.created',
      targetType: 'sla_policy',
      targetId: policy.id,
      diff: { after: { name: policy.name, scope: policy.scope } },
    })
    return policy
  })

export const updateSlaPolicyFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: slaPolicyIdSchema,
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      priority: z.number().int().optional(),
      enabled: z.boolean().optional(),
      appliesToPriorities: z.array(z.enum(TICKET_PRIORITIES)).optional(),
      businessHoursId: businessHoursIdSchema.nullable().optional(),
      pauseOnPending: z.boolean().optional(),
      pauseOnOnHold: z.boolean().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.SLA_MANAGE)
    const { id, ...patch } = data
    const policy = await updateSlaPolicy(id, patch)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'sla_policy.updated',
      targetType: 'sla_policy',
      targetId: id,
    })
    return policy
  })

export const archiveSlaPolicyFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: slaPolicyIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.SLA_MANAGE)
    const policy = await archiveSlaPolicy(data.id)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'sla_policy.archived',
      targetType: 'sla_policy',
      targetId: data.id,
    })
    return policy
  })

export const replaceSlaTargetsFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      policyId: slaPolicyIdSchema,
      targets: z.array(
        z.object({
          kind: z.enum(SLA_TARGET_KINDS),
          minutes: z.number().int().positive(),
        })
      ),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.SLA_MANAGE)
    const rows = await replaceTargets(data.policyId, data.targets)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'sla_policy.targets_updated',
      targetType: 'sla_policy',
      targetId: data.policyId,
      diff: { after: { count: rows.length } },
    })
    return rows
  })

// ---- escalation rules ----

export const listEscalationRulesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ policyId: slaPolicyIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.SLA_VIEW)
    return listEscalationRulesForPolicy(data.policyId)
  })

export const createEscalationRuleFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      policyId: slaPolicyIdSchema,
      name: z.string().min(1).max(200),
      leadMinutes: z.number().int(),
      targetKind: z.enum(SLA_TARGET_KINDS),
      recipientType: z.enum(ESCALATION_RECIPIENT_TYPES),
      recipientTeamId: teamIdSchema.nullable().optional(),
      recipientPrincipalIds: z.array(principalIdSchema).optional(),
      channels: z.array(z.enum(ESCALATION_CHANNELS)).optional(),
      enabled: z.boolean().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ESCALATION_RULE_MANAGE)
    const rule = await createEscalationRule(data)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'escalation_rule.created',
      targetType: 'escalation_rule',
      targetId: rule.id,
      diff: { after: { name: rule.name, leadMinutes: rule.leadMinutes } },
    })
    return rule
  })

export const updateEscalationRuleFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: escalationRuleIdSchema,
      name: z.string().min(1).max(200).optional(),
      leadMinutes: z.number().int().optional(),
      targetKind: z.enum(SLA_TARGET_KINDS).optional(),
      recipientType: z.enum(ESCALATION_RECIPIENT_TYPES).optional(),
      recipientTeamId: teamIdSchema.nullable().optional(),
      recipientPrincipalIds: z.array(principalIdSchema).optional(),
      channels: z.array(z.enum(ESCALATION_CHANNELS)).optional(),
      enabled: z.boolean().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ESCALATION_RULE_MANAGE)
    const { id, ...patch } = data
    const rule = await updateEscalationRule(id, patch)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'escalation_rule.updated',
      targetType: 'escalation_rule',
      targetId: id,
    })
    return rule
  })

export const deleteEscalationRuleFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: escalationRuleIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ESCALATION_RULE_MANAGE)
    await deleteEscalationRule(data.id)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'escalation_rule.deleted',
      targetType: 'escalation_rule',
      targetId: data.id,
    })
    return { ok: true }
  })

// ---- ticket clocks ----

export const getTicketSlaClocksFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ ticketId: ticketIdSchema, includeAll: z.boolean().optional() }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.SLA_VIEW)
    return data.includeAll
      ? getAllClocksForTicket(data.ticketId)
      : getActiveClocksForTicket(data.ticketId)
  })

export const listBreachingClocksFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({ windowMinutes: z.number().int().optional(), limit: z.number().int().optional() })
  )
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.SLA_VIEW)
    return listBreachingClocks(data)
  })

export const runSlaTickFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ batchSize: z.number().int().optional() }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.SLA_MANAGE)
    return runEscalationTick({ batchSize: data.batchSize })
  })
