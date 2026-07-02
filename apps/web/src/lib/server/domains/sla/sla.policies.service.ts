/**
 * SLA policies service — CRUD for policies, targets, escalation rules.
 *
 * Permission gating is the caller's responsibility.
 */

import {
  db,
  eq,
  isNull,
  asc,
  slaPolicies,
  slaTargets,
  escalationRules,
  type SlaPolicy,
  type SlaTarget,
  type EscalationRule,
} from '@/lib/server/db'
import type {
  SlaPolicyId,
  EscalationRuleId,
  TeamId,
  InboxId,
  BusinessHoursId,
  PrincipalId,
} from '@quackback/ids'
import type {
  SlaPolicyScope,
  SlaTargetKind,
  EscalationRecipientType,
  EscalationChannel,
  TicketPriority,
} from '@/lib/server/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  SLA_POLICY_SCOPES,
  SLA_TARGET_KINDS,
  ESCALATION_RECIPIENT_TYPES,
  ESCALATION_CHANNELS,
} from '@/lib/server/db'
import {
  dispatchSlaPolicyCreated,
  dispatchSlaPolicyUpdated,
  dispatchSlaPolicyArchived,
  type EventActor,
} from '@/lib/server/events/dispatch'
import type { EventSlaPolicyRef } from '@/lib/server/events/types'
import { toIsoStringOrNull } from '@/lib/shared/utils/date'

const slaPolicyActor: EventActor = { type: 'service', displayName: 'sla-system' }

function slaPolicyRef(p: SlaPolicy): EventSlaPolicyRef {
  return {
    id: p.id,
    name: p.name,
    scope: p.scope,
    enabled: p.enabled,
    priority: p.priority,
    archivedAt: toIsoStringOrNull(p.archivedAt),
  }
}

const NAME_MAX = 200

function normalizeName(name: string): string {
  const t = name?.trim()
  if (!t) throw new ValidationError('SLA_POLICY_NAME_REQUIRED', 'name is required')
  if (t.length > NAME_MAX)
    throw new ValidationError('SLA_POLICY_NAME_TOO_LONG', `name exceeds ${NAME_MAX} chars`)
  return t
}

// ---------------------------------------------------------------------------
// policies
// ---------------------------------------------------------------------------

export interface CreateSlaPolicyInput {
  name: string
  description?: string | null
  priority?: number
  enabled?: boolean
  scope: SlaPolicyScope
  scopeTeamId?: TeamId | null
  scopeInboxId?: InboxId | null
  appliesToPriorities?: TicketPriority[]
  businessHoursId?: BusinessHoursId | null
  pauseOnPending?: boolean
  pauseOnOnHold?: boolean
}

function validateScope(input: {
  scope: SlaPolicyScope
  scopeTeamId?: TeamId | null
  scopeInboxId?: InboxId | null
}): void {
  if (!SLA_POLICY_SCOPES.includes(input.scope)) {
    throw new ValidationError('SLA_POLICY_SCOPE_INVALID', 'invalid scope')
  }
  if (input.scope === 'team' && !input.scopeTeamId) {
    throw new ValidationError(
      'SLA_POLICY_SCOPE_TEAM_REQUIRED',
      'scopeTeamId required for scope=team'
    )
  }
  if (input.scope === 'inbox' && !input.scopeInboxId) {
    throw new ValidationError(
      'SLA_POLICY_SCOPE_INBOX_REQUIRED',
      'scopeInboxId required for scope=inbox'
    )
  }
  if (input.scope === 'workspace' && (input.scopeTeamId || input.scopeInboxId)) {
    throw new ValidationError(
      'SLA_POLICY_SCOPE_WORKSPACE_NO_BIND',
      'workspace-scoped policy cannot have team/inbox scope'
    )
  }
}

export async function createSlaPolicy(input: CreateSlaPolicyInput): Promise<SlaPolicy> {
  const name = normalizeName(input.name)
  validateScope(input)
  const [created] = await db
    .insert(slaPolicies)
    .values({
      name,
      description: input.description ?? null,
      priority: input.priority ?? 100,
      enabled: input.enabled ?? true,
      scope: input.scope,
      scopeTeamId: input.scopeTeamId ?? null,
      scopeInboxId: input.scopeInboxId ?? null,
      appliesToPriorities: input.appliesToPriorities ?? [],
      businessHoursId: input.businessHoursId ?? null,
      pauseOnPending: input.pauseOnPending ?? true,
      pauseOnOnHold: input.pauseOnOnHold ?? true,
    })
    .returning()
  void dispatchSlaPolicyCreated(slaPolicyActor, slaPolicyRef(created)).catch(() => {})
  return created
}

export interface UpdateSlaPolicyInput {
  name?: string
  description?: string | null
  priority?: number
  enabled?: boolean
  appliesToPriorities?: TicketPriority[]
  businessHoursId?: BusinessHoursId | null
  pauseOnPending?: boolean
  pauseOnOnHold?: boolean
}

export async function updateSlaPolicy(
  id: SlaPolicyId,
  input: UpdateSlaPolicyInput
): Promise<SlaPolicy> {
  const existing = await getSlaPolicy(id)
  if (!existing) throw new NotFoundError('SLA_POLICY_NOT_FOUND', `policy ${id} not found`)
  if (existing.archivedAt) {
    throw new ConflictError('SLA_POLICY_ARCHIVED', 'cannot update archived policy')
  }
  const patch: Partial<typeof existing> = {}
  if (input.name !== undefined) patch.name = normalizeName(input.name)
  if (input.description !== undefined) patch.description = input.description
  if (input.priority !== undefined) patch.priority = input.priority
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.appliesToPriorities !== undefined) patch.appliesToPriorities = input.appliesToPriorities
  if (input.businessHoursId !== undefined) patch.businessHoursId = input.businessHoursId
  if (input.pauseOnPending !== undefined) patch.pauseOnPending = input.pauseOnPending
  if (input.pauseOnOnHold !== undefined) patch.pauseOnOnHold = input.pauseOnOnHold
  if (Object.keys(patch).length === 0) return existing
  const [updated] = await db
    .update(slaPolicies)
    .set(patch)
    .where(eq(slaPolicies.id, id))
    .returning()
  void dispatchSlaPolicyUpdated(slaPolicyActor, slaPolicyRef(updated), Object.keys(patch)).catch(
    () => {}
  )
  return updated
}

export async function archiveSlaPolicy(id: SlaPolicyId): Promise<SlaPolicy> {
  const [updated] = await db
    .update(slaPolicies)
    .set({ archivedAt: new Date(), enabled: false })
    .where(eq(slaPolicies.id, id))
    .returning()
  if (!updated) throw new NotFoundError('SLA_POLICY_NOT_FOUND', `policy ${id} not found`)
  void dispatchSlaPolicyArchived(slaPolicyActor, slaPolicyRef(updated)).catch(() => {})
  return updated
}

export async function getSlaPolicy(id: SlaPolicyId): Promise<SlaPolicy | null> {
  const row = await db.query.slaPolicies.findFirst({ where: eq(slaPolicies.id, id) })
  return row ?? null
}

export async function listSlaPolicies(
  opts: { includeArchived?: boolean } = {}
): Promise<SlaPolicy[]> {
  const where = opts.includeArchived ? undefined : isNull(slaPolicies.archivedAt)
  return db
    .select()
    .from(slaPolicies)
    .where(where)
    .orderBy(asc(slaPolicies.priority), asc(slaPolicies.createdAt))
}

// ---------------------------------------------------------------------------
// targets (whole-set replace)
// ---------------------------------------------------------------------------

export interface SlaTargetInput {
  kind: SlaTargetKind
  minutes: number
}

export async function listTargetsForPolicy(policyId: SlaPolicyId): Promise<SlaTarget[]> {
  return db.select().from(slaTargets).where(eq(slaTargets.policyId, policyId))
}

/** Replace the full target set for a policy. Atomic. */
export async function replaceTargets(
  policyId: SlaPolicyId,
  targets: SlaTargetInput[]
): Promise<SlaTarget[]> {
  for (const t of targets) {
    if (!SLA_TARGET_KINDS.includes(t.kind)) {
      throw new ValidationError('SLA_TARGET_KIND_INVALID', `invalid kind: ${t.kind}`)
    }
    if (!Number.isFinite(t.minutes) || t.minutes <= 0) {
      throw new ValidationError(
        'SLA_TARGET_MINUTES_INVALID',
        `minutes must be > 0 (got ${t.minutes})`
      )
    }
  }
  // Dedup by kind (keep last).
  const map = new Map<SlaTargetKind, number>()
  for (const t of targets) map.set(t.kind, t.minutes)

  return db.transaction(async (tx) => {
    await tx.delete(slaTargets).where(eq(slaTargets.policyId, policyId))
    if (map.size === 0) return []
    const rows = await tx
      .insert(slaTargets)
      .values(
        Array.from(map.entries()).map(([kind, minutes]) => ({
          policyId,
          kind,
          minutes,
        }))
      )
      .returning()
    return rows
  })
}

// ---------------------------------------------------------------------------
// escalation rules
// ---------------------------------------------------------------------------

export interface CreateEscalationRuleInput {
  policyId: SlaPolicyId
  name: string
  leadMinutes: number
  targetKind: SlaTargetKind
  recipientType: EscalationRecipientType
  recipientTeamId?: TeamId | null
  recipientPrincipalIds?: PrincipalId[]
  channels?: EscalationChannel[]
  enabled?: boolean
}

function validateEscalation(input: Partial<CreateEscalationRuleInput>): void {
  if (input.targetKind != null && !SLA_TARGET_KINDS.includes(input.targetKind)) {
    throw new ValidationError('ESCALATION_TARGET_KIND_INVALID', 'invalid targetKind')
  }
  if (input.recipientType != null && !ESCALATION_RECIPIENT_TYPES.includes(input.recipientType)) {
    throw new ValidationError('ESCALATION_RECIPIENT_TYPE_INVALID', 'invalid recipientType')
  }
  if (input.recipientType === 'team' && !input.recipientTeamId) {
    throw new ValidationError(
      'ESCALATION_RECIPIENT_TEAM_REQUIRED',
      'recipientTeamId required for recipientType=team'
    )
  }
  if (input.recipientType === 'principals') {
    const ids = input.recipientPrincipalIds ?? []
    if (ids.length === 0) {
      throw new ValidationError(
        'ESCALATION_RECIPIENT_PRINCIPALS_REQUIRED',
        'at least one principal required for recipientType=principals'
      )
    }
  }
  if (input.channels != null) {
    for (const c of input.channels) {
      if (!ESCALATION_CHANNELS.includes(c)) {
        throw new ValidationError('ESCALATION_CHANNEL_INVALID', `invalid channel: ${c}`)
      }
    }
  }
  if (input.leadMinutes != null && !Number.isFinite(input.leadMinutes)) {
    throw new ValidationError('ESCALATION_LEAD_MINUTES_INVALID', 'leadMinutes must be a number')
  }
}

export async function createEscalationRule(
  input: CreateEscalationRuleInput
): Promise<EscalationRule> {
  validateEscalation(input)
  const name = normalizeName(input.name)
  const [created] = await db
    .insert(escalationRules)
    .values({
      policyId: input.policyId,
      name,
      leadMinutes: input.leadMinutes,
      targetKind: input.targetKind,
      recipientType: input.recipientType,
      recipientTeamId: input.recipientTeamId ?? null,
      recipientPrincipalIds: input.recipientPrincipalIds ?? [],
      channels: input.channels ?? ['in_app'],
      enabled: input.enabled ?? true,
    })
    .returning()
  return created
}

export interface UpdateEscalationRuleInput {
  name?: string
  leadMinutes?: number
  targetKind?: SlaTargetKind
  recipientType?: EscalationRecipientType
  recipientTeamId?: TeamId | null
  recipientPrincipalIds?: PrincipalId[]
  channels?: EscalationChannel[]
  enabled?: boolean
}

export async function updateEscalationRule(
  id: EscalationRuleId,
  input: UpdateEscalationRuleInput
): Promise<EscalationRule> {
  validateEscalation(input)
  const existing = await db.query.escalationRules.findFirst({
    where: eq(escalationRules.id, id),
  })
  if (!existing) throw new NotFoundError('ESCALATION_RULE_NOT_FOUND', `rule ${id} not found`)
  const patch: Partial<typeof existing> = {}
  if (input.name !== undefined) patch.name = normalizeName(input.name)
  if (input.leadMinutes !== undefined) patch.leadMinutes = input.leadMinutes
  if (input.targetKind !== undefined) patch.targetKind = input.targetKind
  if (input.recipientType !== undefined) patch.recipientType = input.recipientType
  if (input.recipientTeamId !== undefined) patch.recipientTeamId = input.recipientTeamId
  if (input.recipientPrincipalIds !== undefined)
    patch.recipientPrincipalIds = input.recipientPrincipalIds
  if (input.channels !== undefined) patch.channels = input.channels
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (Object.keys(patch).length === 0) return existing
  const [updated] = await db
    .update(escalationRules)
    .set(patch)
    .where(eq(escalationRules.id, id))
    .returning()
  return updated
}

export async function deleteEscalationRule(id: EscalationRuleId): Promise<void> {
  await db.delete(escalationRules).where(eq(escalationRules.id, id))
}

export async function listEscalationRulesForPolicy(
  policyId: SlaPolicyId
): Promise<EscalationRule[]> {
  return db
    .select()
    .from(escalationRules)
    .where(eq(escalationRules.policyId, policyId))
    .orderBy(asc(escalationRules.leadMinutes))
}
