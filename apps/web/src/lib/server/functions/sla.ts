/**
 * Server functions for SLA policies (support platform §4.6): the settings
 * page's CRUD + archive lifecycle over the shipped domain service, the picker
 * options feed for the workflow canvas, and the manual remove-SLA agent
 * action. Management is gated on sla.manage; the picker and removal reuse the
 * conversation permissions agents already hold. Archive is blocked while any
 * LIVE workflow still applies the policy (the result lists them); update may
 * add or change targets but never remove one (edits only affect future
 * applications — applied clocks are snapshotted).
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { isValidTypeId } from '@quackback/ids'
import type { ConversationId, OfficeHoursId, SlaPolicyId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { slaTargetsSummary } from '@/lib/shared/conversation/sla'
import type { SlaPolicy, Workflow } from '@/lib/server/db'
import {
  createSlaPolicy,
  getSlaPolicy,
  listSlaPolicies,
  listSlaPoliciesIncludingArchived,
  restoreSlaPolicy,
  softDeleteSlaPolicy,
  updateSlaPolicy,
} from '@/lib/server/domains/sla/sla-policy.service'
import { removeSlaFromConversation } from '@/lib/server/domains/sla/sla.service'
import { listWorkflows } from '@/lib/server/domains/workflows/workflow.service'
import { getOfficeHoursSchedule } from '@/lib/server/domains/settings/settings.office-hours'

/** A workflow that applies a policy, as listed on rows and in-use warnings. */
export interface SlaWorkflowRef {
  id: string
  name: string
  status: string
}

/**
 * Workflows whose graph contains an Apply-SLA action referencing the policy.
 * Deliberately defensive over the stored JSON: a malformed graph just never
 * matches.
 */
export function workflowsReferencingPolicy(
  workflows: Pick<Workflow, 'id' | 'name' | 'status' | 'graph'>[],
  policyId: string
): SlaWorkflowRef[] {
  return workflows
    .filter((w) => {
      const nodes = (w.graph as { nodes?: unknown } | null)?.nodes
      if (!Array.isArray(nodes)) return false
      return nodes.some((node) => {
        const action = (node as { action?: { type?: string; policyId?: string } } | null)?.action
        return action?.type === 'apply_sla' && action.policyId === policyId
      })
    })
    .map((w) => ({ id: w.id, name: w.name, status: w.status }))
}

export interface SlaPolicyDTO {
  id: string
  name: string
  firstResponseTargetSecs: number | null
  nextResponseTargetSecs: number | null
  timeToCloseTargetSecs: number | null
  pauseOnSnooze: boolean
  officeHoursScheduleId: string | null
  /** Archive timestamp (the domain's soft-delete); null while live. */
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  usedByWorkflows: SlaWorkflowRef[]
}

function serializePolicy(p: SlaPolicy, usedByWorkflows: SlaWorkflowRef[]): SlaPolicyDTO {
  return {
    id: p.id,
    name: p.name,
    firstResponseTargetSecs: p.firstResponseTargetSecs,
    nextResponseTargetSecs: p.nextResponseTargetSecs,
    timeToCloseTargetSecs: p.timeToCloseTargetSecs,
    pauseOnSnooze: p.pauseOnSnooze,
    officeHoursScheduleId: p.officeHoursScheduleId,
    archivedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    usedByWorkflows,
  }
}

// A duration target in seconds; null = that clock is untracked. Capped at a
// year — beyond that a target stops being an SLA.
const targetSecs = z
  .number()
  .int()
  .positive()
  .max(365 * 86400)
  .nullable()
const nameSchema = z.string().trim().min(1).max(120)
const scheduleIdSchema = z.string().nullable()

const createSchema = z
  .object({
    name: nameSchema,
    firstResponseTargetSecs: targetSecs.optional(),
    nextResponseTargetSecs: targetSecs.optional(),
    timeToCloseTargetSecs: targetSecs.optional(),
    pauseOnSnooze: z.boolean().optional(),
    officeHoursScheduleId: scheduleIdSchema.optional(),
  })
  .refine(
    (d) =>
      [d.firstResponseTargetSecs, d.nextResponseTargetSecs, d.timeToCloseTargetSecs].some(
        (v) => v != null
      ),
    { message: 'Set at least one target' }
  )

const updateSchema = z.object({
  id: z.string(),
  name: nameSchema.optional(),
  firstResponseTargetSecs: targetSecs.optional(),
  nextResponseTargetSecs: targetSecs.optional(),
  timeToCloseTargetSecs: targetSecs.optional(),
  pauseOnSnooze: z.boolean().optional(),
  officeHoursScheduleId: scheduleIdSchema.optional(),
})

const idSchema = z.object({ id: z.string() })

/** undefined = unchanged, null = clear to 24/7, otherwise a validated id. */
function parseScheduleId(v: string | null | undefined): OfficeHoursId | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (!isValidTypeId(v, 'office_hours')) throw new Error('Invalid office-hours schedule id')
  return v as OfficeHoursId
}

const TARGET_KEYS = [
  'firstResponseTargetSecs',
  'nextResponseTargetSecs',
  'timeToCloseTargetSecs',
] as const

/** Full policy list (live + archived) with per-policy workflow references. */
export const listSlaPoliciesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SlaPolicyDTO[]> => {
    await requireAuth({ permission: PERMISSIONS.SLA_MANAGE })
    const [policies, workflows] = await Promise.all([
      listSlaPoliciesIncludingArchived(),
      listWorkflows(),
    ])
    return policies.map((p) => serializePolicy(p, workflowsReferencingPolicy(workflows, p.id)))
  }
)

export interface SlaPolicyOption {
  id: string
  name: string
  targetsSummary: string
}

/** Live policies for the workflow canvas's Apply-SLA picker. */
export const listSlaPolicyOptionsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SlaPolicyOption[]> => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    return (await listSlaPolicies()).map((p) => ({
      id: p.id,
      name: p.name,
      targetsSummary: slaTargetsSummary(p),
    }))
  }
)

/** Whether the workspace office-hours schedule (the settings blob, the same
 *  source Messenger and the workflows condition read) is enabled — the policy
 *  editor's "which clock do these targets run on" hint. */
export const getSlaOfficeHoursFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ officeHoursEnabled: boolean }> => {
    await requireAuth({ permission: PERMISSIONS.SLA_MANAGE })
    const schedule = await getOfficeHoursSchedule()
    return { officeHoursEnabled: schedule.enabled }
  }
)

export const createSlaPolicyFn = createServerFn({ method: 'POST' })
  .validator(createSchema)
  .handler(async ({ data }): Promise<SlaPolicyDTO> => {
    await requireAuth({ permission: PERMISSIONS.SLA_MANAGE })
    const created = await createSlaPolicy({
      name: data.name,
      firstResponseTargetSecs: data.firstResponseTargetSecs ?? null,
      nextResponseTargetSecs: data.nextResponseTargetSecs ?? null,
      timeToCloseTargetSecs: data.timeToCloseTargetSecs ?? null,
      pauseOnSnooze: data.pauseOnSnooze,
      officeHoursScheduleId: parseScheduleId(data.officeHoursScheduleId) ?? null,
    })
    return serializePolicy(created, [])
  })

export type UpdateSlaPolicyResult =
  | { ok: true }
  | { ok: false; code: 'TARGET_REMOVAL'; message: string }

export const updateSlaPolicyFn = createServerFn({ method: 'POST' })
  .validator(updateSchema)
  .handler(async ({ data }): Promise<UpdateSlaPolicyResult> => {
    await requireAuth({ permission: PERMISSIONS.SLA_MANAGE })
    const id = data.id as SlaPolicyId
    // getSlaPolicy is live-only, so an archived policy can't be edited.
    const existing = await getSlaPolicy(id)
    if (!existing) throw new Error('SLA policy not found')
    // Targets may be added or changed, never removed once set (matching the
    // "edits apply to new conversations only" contract).
    const removed = TARGET_KEYS.filter((k) => existing[k] != null && data[k] === null)
    if (removed.length > 0) {
      return {
        ok: false,
        code: 'TARGET_REMOVAL',
        message: 'Targets can be changed but not removed once set',
      }
    }
    await updateSlaPolicy(id, {
      name: data.name,
      firstResponseTargetSecs: data.firstResponseTargetSecs,
      nextResponseTargetSecs: data.nextResponseTargetSecs,
      timeToCloseTargetSecs: data.timeToCloseTargetSecs,
      pauseOnSnooze: data.pauseOnSnooze,
      officeHoursScheduleId: parseScheduleId(data.officeHoursScheduleId),
    })
    return { ok: true }
  })

export type ArchiveSlaPolicyResult =
  | { ok: true }
  | { ok: false; code: 'SLA_IN_USE'; workflows: { id: string; name: string }[] }

/** Archive (soft-delete) a policy; blocked while a LIVE workflow applies it.
 *  Archived policies stay on already-applied conversations and in reports. */
export const archiveSlaPolicyFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }): Promise<ArchiveSlaPolicyResult> => {
    await requireAuth({ permission: PERMISSIONS.SLA_MANAGE })
    const references = workflowsReferencingPolicy(await listWorkflows(), data.id)
    const live = references.filter((w) => w.status === 'live')
    if (live.length > 0) {
      return {
        ok: false,
        code: 'SLA_IN_USE',
        workflows: live.map(({ id, name }) => ({ id, name })),
      }
    }
    await softDeleteSlaPolicy(data.id as SlaPolicyId)
    return { ok: true }
  })

export const restoreSlaPolicyFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await requireAuth({ permission: PERMISSIONS.SLA_MANAGE })
    await restoreSlaPolicy(data.id as SlaPolicyId)
    return { ok: true }
  })

/** Agent action: remove the active SLA from a conversation (overflow menu). */
export const removeConversationSlaFn = createServerFn({ method: 'POST' })
  .validator(z.object({ conversationId: z.string() }))
  .handler(async ({ data }): Promise<{ ok: true; removed: boolean }> => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_SET_STATUS })
    const row = await removeSlaFromConversation(data.conversationId as ConversationId)
    if (row) {
      // Broadcast the fresh agent DTO so other open inboxes drop the chip; the
      // publish helper strips the (now-null anyway) SLA from the visitor copy.
      const { conversationToDTO } =
        await import('@/lib/server/domains/conversation/conversation.query')
      const { publishConversationUpdate } =
        await import('@/lib/server/realtime/conversation-channels')
      publishConversationUpdate(row.id, await conversationToDTO(row, 'agent'))
    }
    return { ok: true, removed: !!row }
  })
