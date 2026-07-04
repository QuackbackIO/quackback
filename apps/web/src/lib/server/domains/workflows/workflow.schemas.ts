/**
 * Zod validation for a workflow graph + trigger settings (support platform §4.6).
 * The engine reads a stored graph defensively (a malformed shape just produces
 * nothing), but authoring should fail loud, so the fn layer validates writes
 * here. The schemas mirror the domain types (WorkflowAction / WorkflowCondition /
 * WorkflowNode / WorkflowGraph); a compile-time check at the bottom pins them to
 * the types so the two can't silently drift.
 */
import { z } from 'zod'
import type { WorkflowCondition } from './condition.evaluator'

const conditionOperator = z.enum([
  'eq',
  'neq',
  'contains',
  'not_contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'includes_any',
  'excludes_all',
  'is_set',
  'is_empty',
])

const conditionLeaf = z.object({
  field: z.string().min(1),
  op: conditionOperator,
  value: z.unknown().optional(),
})

// Recursive: a group nests conditions under all / any.
const conditionSchema: z.ZodType<WorkflowCondition> = z.lazy(() =>
  z.union([
    conditionLeaf,
    z.object({
      all: z.array(conditionSchema).optional(),
      any: z.array(conditionSchema).optional(),
    }),
  ])
)

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assign_agent'), principalId: z.string().min(1) }),
  z.object({ type: z.literal('assign_team'), teamId: z.string().min(1) }),
  z.object({ type: z.literal('add_tag'), tagId: z.string().min(1) }),
  z.object({ type: z.literal('remove_tag'), tagId: z.string().min(1) }),
  z.object({
    type: z.literal('set_priority'),
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  }),
  // untilIso is serializable (ISO string) or null = until reply.
  z.object({ type: z.literal('snooze'), untilIso: z.string().datetime().nullable() }),
  z.object({ type: z.literal('close') }),
  z.object({ type: z.literal('apply_sla'), policyId: z.string().min(1) }),
  z.object({ type: z.literal('set_attribute'), key: z.string().min(1), value: z.unknown() }),
])

const nodeSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('trigger') }),
  z.object({ id: z.string().min(1), type: z.literal('action'), action: actionSchema }),
  z.object({ id: z.string().min(1), type: z.literal('condition'), condition: conditionSchema }),
  z.object({
    id: z.string().min(1),
    type: z.literal('branch'),
    branches: z.array(z.object({ key: z.string().min(1), condition: conditionSchema })),
  }),
  z.object({ id: z.string().min(1), type: z.literal('wait'), seconds: z.number().int().min(0) }),
])

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  branch: z.string().optional(),
})

export const workflowGraphSchema = z.object({
  nodes: z.array(nodeSchema).max(200),
  edges: z.array(edgeSchema).max(400),
})

export const triggerSettingsSchema = z.record(z.string(), z.unknown())

/**
 * The validated graph, with plain-string ids. The domain WorkflowGraph uses
 * branded TypeIDs on action fields; a validated string satisfies them at runtime,
 * so callers cast this to WorkflowGraph at the boundary. Keep this schema in sync
 * with the WorkflowAction / WorkflowNode / WorkflowGraph domain types by hand —
 * the branded ids make a structural compile-time equality check impractical.
 */
export type ValidatedWorkflowGraph = z.infer<typeof workflowGraphSchema>
