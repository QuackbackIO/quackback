/**
 * Support config schema registrations: inboxes, channels, memberships,
 * routing rules, business hours, SLA policies, escalation rules.
 *
 * Phase 4 + Phase 5 backend.
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  TypeIdSchema,
  createItemResponseSchema,
  createPaginatedResponseSchema,
  asSchema,
} from '../openapi'
import { TimestampSchema, NullableTimestampSchema, UnauthorizedErrorSchema } from './common'

// ---------------------------------------------------------------------------
// Inboxes
// ---------------------------------------------------------------------------

const InboxSchema = z.object({
  id: TypeIdSchema.meta({ example: 'inbox_01h455vb4pex5vsknk084sn02q' }),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  primaryTeamId: TypeIdSchema.nullable(),
  defaultVisibilityScope: z.enum(['team', 'org', 'shared', 'private']),
  defaultPriority: z.enum(['low', 'normal', 'high', 'urgent']),
  defaultStatusId: TypeIdSchema.nullable(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  archivedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

registerPath('/inboxes', {
  get: {
    tags: ['Support Config'],
    summary: 'List inboxes',
    responses: {
      200: {
        description: 'Inboxes',
        content: {
          'application/json': { schema: createPaginatedResponseSchema(InboxSchema, 'Inboxes') },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
  post: {
    tags: ['Support Config'],
    summary: 'Create an inbox',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              name: z.string().min(1).max(200),
              slug: z.string().regex(/^[a-z0-9-]+$/),
              description: z.string().max(500).optional(),
              primaryTeamId: TypeIdSchema.nullable().optional(),
              defaultVisibilityScope: z.enum(['team', 'org', 'shared', 'private']).optional(),
              defaultPriority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
              color: z.string().optional(),
              icon: z.string().optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'Inbox created',
        content: { 'application/json': { schema: createItemResponseSchema(InboxSchema, 'Inbox') } },
      },
    },
  },
})

registerPath('/inboxes/{inboxId}', {
  get: {
    tags: ['Support Config'],
    summary: 'Get an inbox',
    parameters: [{ name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: {
      200: {
        description: 'Inbox',
        content: { 'application/json': { schema: createItemResponseSchema(InboxSchema, 'Inbox') } },
      },
    },
  },
  patch: {
    tags: ['Support Config'],
    summary: 'Update an inbox',
    parameters: [{ name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['Support Config'],
    summary: 'Archive an inbox',
    parameters: [{ name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Archived' } },
  },
})

registerPath('/inboxes/{inboxId}/members', {
  get: {
    tags: ['Support Config'],
    summary: 'List inbox members',
    parameters: [{ name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Members' } },
  },
  post: {
    tags: ['Support Config'],
    summary: 'Add inbox member',
    parameters: [{ name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 201: { description: 'Added' } },
  },
})

registerPath('/inboxes/{inboxId}/channels', {
  get: {
    tags: ['Support Config'],
    summary: 'List channels',
    parameters: [{ name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Channels' } },
  },
  post: {
    tags: ['Support Config'],
    summary: 'Create a channel',
    parameters: [{ name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 201: { description: 'Created' } },
  },
})

// ---------------------------------------------------------------------------
// Routing rules
// ---------------------------------------------------------------------------

const RoutingRuleSchema = z.object({
  id: TypeIdSchema.meta({ example: 'route_rule_01h455vb4pex5vsknk084sn02q' }),
  name: z.string(),
  description: z.string().nullable(),
  priority: z.number(),
  enabled: z.boolean(),
  conditions: z.unknown(),
  actions: z.unknown(),
  inboxIdScope: TypeIdSchema.nullable(),
  matchCount: z.number(),
  lastMatchedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

registerPath('/routing-rules', {
  get: {
    tags: ['Routing'],
    summary: 'List routing rules (priority-ordered)',
    responses: {
      200: {
        description: 'Rules',
        content: {
          'application/json': { schema: createPaginatedResponseSchema(RoutingRuleSchema, 'Rules') },
        },
      },
    },
  },
  post: {
    tags: ['Routing'],
    summary: 'Create a routing rule',
    responses: { 201: { description: 'Created' } },
  },
})

registerPath('/routing-rules/{ruleId}', {
  get: {
    tags: ['Routing'],
    summary: 'Get a routing rule',
    parameters: [{ name: 'ruleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Rule' } },
  },
  patch: {
    tags: ['Routing'],
    summary: 'Update a routing rule',
    parameters: [{ name: 'ruleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['Routing'],
    summary: 'Delete a routing rule',
    parameters: [{ name: 'ruleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Deleted' } },
  },
})

registerPath('/routing-rules/reorder', {
  post: {
    tags: ['Routing'],
    summary: 'Reorder routing rules',
    description: 'Replace routing-rule evaluation order by passing the rule IDs in desired order.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({ orderedIds: z.array(TypeIdSchema).min(1) }).meta({
              description: 'Routing-rule IDs in desired evaluation order',
            })
          ),
        },
      },
    },
    responses: { 200: { description: 'Rules reordered' } },
  },
})

// ---------------------------------------------------------------------------
// Business hours
// ---------------------------------------------------------------------------

const BusinessHoursSchema = z.object({
  id: TypeIdSchema.meta({ example: 'bizhrs_01h455vb4pex5vsknk084sn02q' }),
  name: z.string(),
  timezone: z.string().meta({ example: 'America/New_York' }),
  schedule: z.unknown(),
  holidays: z.unknown(),
  archivedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

registerPath('/business-hours', {
  get: {
    tags: ['SLA'],
    summary: 'List business-hours calendars',
    responses: {
      200: {
        description: 'Calendars',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(BusinessHoursSchema, 'Calendars'),
          },
        },
      },
    },
  },
  post: {
    tags: ['SLA'],
    summary: 'Create a business-hours calendar',
    responses: { 201: { description: 'Created' } },
  },
})

registerPath('/business-hours/{id}', {
  get: {
    tags: ['SLA'],
    summary: 'Get a calendar',
    parameters: [{ name: 'id', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Calendar' } },
  },
  patch: {
    tags: ['SLA'],
    summary: 'Update a calendar',
    parameters: [{ name: 'id', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['SLA'],
    summary: 'Archive a calendar',
    parameters: [{ name: 'id', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Archived' } },
  },
})

// ---------------------------------------------------------------------------
// SLA policies + targets + escalation rules
// ---------------------------------------------------------------------------

const SlaPolicySchema = z.object({
  id: TypeIdSchema.meta({ example: 'sla_pol_01h455vb4pex5vsknk084sn02q' }),
  name: z.string(),
  description: z.string().nullable(),
  scope: z.enum(['workspace', 'team', 'inbox']),
  scopeTeamId: TypeIdSchema.nullable(),
  scopeInboxId: TypeIdSchema.nullable(),
  priority: z.number(),
  enabled: z.boolean(),
  appliesToPriorities: z.array(z.string()),
  businessHoursId: TypeIdSchema.nullable(),
  pauseOnPending: z.boolean(),
  pauseOnOnHold: z.boolean(),
  archivedAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

registerPath('/sla-policies', {
  get: {
    tags: ['SLA'],
    summary: 'List SLA policies',
    responses: {
      200: {
        description: 'Policies',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(SlaPolicySchema, 'Policies'),
          },
        },
      },
    },
  },
  post: {
    tags: ['SLA'],
    summary: 'Create an SLA policy',
    responses: { 201: { description: 'Created' } },
  },
})

registerPath('/sla-policies/{policyId}', {
  get: {
    tags: ['SLA'],
    summary: 'Get a policy',
    parameters: [{ name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Policy' } },
  },
  patch: {
    tags: ['SLA'],
    summary: 'Update a policy',
    parameters: [{ name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['SLA'],
    summary: 'Archive a policy',
    parameters: [{ name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 204: { description: 'Archived' } },
  },
})

registerPath('/sla-policies/{policyId}/targets', {
  get: {
    tags: ['SLA'],
    summary: 'List targets for a policy',
    parameters: [{ name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Targets' } },
  },
  post: {
    tags: ['SLA'],
    summary: 'Add a target',
    parameters: [{ name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 201: { description: 'Created' } },
  },
  patch: {
    tags: ['SLA'],
    summary: 'Replace target set',
    parameters: [{ name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Replaced' } },
  },
})

registerPath('/sla-policies/{policyId}/escalation-rules', {
  get: {
    tags: ['SLA'],
    summary: 'List escalation rules for a policy',
    parameters: [{ name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Rules' } },
  },
  post: {
    tags: ['SLA'],
    summary: 'Create an escalation rule',
    parameters: [{ name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 201: { description: 'Created' } },
  },
})

registerPath('/sla-policies/{policyId}/escalation-rules/{ruleId}', {
  patch: {
    tags: ['SLA'],
    summary: 'Update an escalation rule',
    parameters: [
      { name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'ruleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['SLA'],
    summary: 'Delete an escalation rule',
    parameters: [
      { name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'ruleId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 204: { description: 'Deleted' } },
  },
})

registerPath('/internal/sla-tick', {
  post: {
    tags: ['SLA'],
    summary: 'Run one SLA escalation tick (internal cron endpoint)',
    description:
      'Protected by `x-internal-secret` header. Designed for pg_cron or external scheduler. Idempotent; safe to call concurrently.',
    responses: {
      200: { description: 'Counters: { escalated, breached }' },
      401: { description: 'Bad shared secret' },
    },
  },
})
