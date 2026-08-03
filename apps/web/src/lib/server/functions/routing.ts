/**
 * Routing-rule server functions.
 *
 * All endpoints require ROUTING_RULE_MANAGE.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { InboxId, RoutingRuleId } from '@quackback/ids'
import { requirePermission } from './auth-helpers'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import {
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
  getRoutingRule,
  listRoutingRules,
  reorderRoutingRules,
  type CreateRoutingRuleInput,
  type UpdateRoutingRuleInput,
} from '@/lib/server/domains/inboxes'
import { recordEvent } from '@/lib/server/domains/audit'

const inboxIdSchema = z.string().min(1) as z.ZodType<InboxId>
const ruleIdSchema = z.string().min(1) as z.ZodType<RoutingRuleId>

// Conditions/actions are validated inside the service via Zod; pass-through here.
const ruleSetSchema = z.unknown()
const actionsSchema = z.unknown()

export const listRoutingRulesFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      inboxIdScope: z.union([inboxIdSchema, z.literal('workspace')]).optional(),
      enabledOnly: z.boolean().optional(),
    })
  )
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ROUTING_RULE_MANAGE)
    return listRoutingRules(data)
  })

export const getRoutingRuleFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ ruleId: ruleIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.ROUTING_RULE_MANAGE)
    return getRoutingRule(data.ruleId)
  })

export const createRoutingRuleFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).nullable().optional(),
      priority: z.number().int().min(0).max(1_000_000).optional(),
      enabled: z.boolean().optional(),
      conditions: ruleSetSchema,
      actions: actionsSchema,
      inboxIdScope: inboxIdSchema.nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ROUTING_RULE_MANAGE)
    const rule = await createRoutingRule(data as unknown as CreateRoutingRuleInput)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'routing_rule.created',
      targetType: 'routing_rule',
      targetId: rule.id,
      diff: { after: { name: rule.name, priority: rule.priority } },
    })
    return rule
  })

export const updateRoutingRuleFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      ruleId: ruleIdSchema,
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      priority: z.number().int().min(0).max(1_000_000).optional(),
      enabled: z.boolean().optional(),
      conditions: ruleSetSchema.optional(),
      actions: actionsSchema.optional(),
      inboxIdScope: inboxIdSchema.nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ROUTING_RULE_MANAGE)
    const { ruleId, ...patch } = data
    const rule = await updateRoutingRule(ruleId, patch as unknown as UpdateRoutingRuleInput)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'routing_rule.updated',
      targetType: 'routing_rule',
      targetId: rule.id,
    })
    return rule
  })

export const deleteRoutingRuleFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ ruleId: ruleIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ROUTING_RULE_MANAGE)
    await deleteRoutingRule(data.ruleId)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'routing_rule.deleted',
      targetType: 'routing_rule',
      targetId: data.ruleId,
    })
    return { ok: true }
  })

export const reorderRoutingRulesFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ orderedIds: z.array(ruleIdSchema).min(1) }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.ROUTING_RULE_MANAGE)
    await reorderRoutingRules(data.orderedIds)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'routing_rule.reordered',
      targetType: 'routing_rule',
      targetId: data.orderedIds[0],
    })
    return { ok: true }
  })
