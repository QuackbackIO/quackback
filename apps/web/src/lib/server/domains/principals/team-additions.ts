/**
 * Adding people to the team from the members page in one batch: people who
 * already sign in to the portal join immediately; email addresses get an
 * invitation. The batch is validated as a whole (eligibility, duplicates,
 * pending invites, the grant ceiling and the seat count) before anything is
 * written, and written in one transaction. The picker query lives in
 * people-to-add.ts.
 */
import { db } from '@/lib/server/db'
import type { InviteId, PrincipalId, RoleId } from '@quackback/ids'
import { ConflictError, ValidationError } from '@/lib/shared/errors'
import { realEmail } from '@/lib/shared/anonymous-email'
import { recordAuditEvent, type AuditActor } from '@/lib/server/audit/log'
import { cacheDel } from '@/lib/server/cache'
import { logger } from '@/lib/server/logger'
import { assertSeatsAvailable } from './seat-limit'
import {
  classifyTeamCandidate,
  loadTeamCandidates,
  promotePortalUsers,
  type TeamCandidate,
} from './team-promotion'
import {
  assertInviteGrant,
  classifyInviteEmail,
  deliverTeamInvite,
  insertTeamInvite,
  mintTeamInvite,
  type InviteWorkspace,
  type MintedTeamInvite,
  type TeamGranter,
} from './team-invitation'

const log = logger.child({ component: 'team-additions' })

/** Most people (ids plus emails) one add request may carry. */
export const MAX_TEAM_ADDITIONS = 50

export interface AddTeamMembersInput {
  principalIds: string[]
  emails: string[]
  role: 'admin' | 'member'
  roleId?: RoleId
}

export interface AddTeamMembersResult {
  added: Array<{ principalId: PrincipalId; name: string }>
  invited: Array<{
    email: string
    invitationId: InviteId
    /** False when no mail transport delivered it; share `inviteLink` instead. */
    emailSent: boolean
    inviteLink?: string
  }>
}

function firstDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>()
  for (const v of values) {
    if (seen.has(v)) return v
    seen.add(v)
  }
  return undefined
}

/** The item a refusal is about, carried on the error so callers can point at it. */
export type RefusedItem = { email: string } | { principalId: string }

function about<E extends Error>(error: E, item: RefusedItem): E & RefusedItem {
  return Object.assign(error, item)
}

function assertPromotable(
  id: PrincipalId,
  candidate: TeamCandidate | undefined,
  granter: TeamGranter
): TeamCandidate {
  const item = { principalId: id }
  if (!candidate) {
    throw about(
      new ValidationError('NOT_ELIGIBLE', 'One of the selected people no longer exists'),
      item
    )
  }
  const who = candidate.name || 'This person'
  if (candidate.id === granter.principalId) {
    throw about(new ConflictError('ALREADY_MEMBER', 'You are already on the team'), item)
  }
  switch (classifyTeamCandidate(candidate)) {
    case 'teammate':
      throw about(new ConflictError('ALREADY_MEMBER', `${who} is already on the team`), item)
    case 'not_a_person':
      throw about(new ValidationError('NOT_ELIGIBLE', `${who} can't be added to the team`), item)
    case 'not_signed_in':
      throw about(
        new ValidationError(
          'NOT_ELIGIBLE',
          `${who} hasn't signed in yet. Invite them by email instead.`
        ),
        item
      )
    case 'eligible':
      return candidate
  }
}

/**
 * Add people to the team in one go: `principalIds` (portal users who have
 * signed in) join at once, `emails` are invited. Everything is validated
 * before any write; the seat count covers the whole batch and is re-checked
 * under the seat-ledger lock on the write transaction. Promotions are audited
 * as user.role.changed. Invitation mail goes out after commit; a send failure
 * does not undo the batch and is reported per invite.
 */
export async function addTeamMembers(
  input: AddTeamMembersInput,
  granter: TeamGranter,
  ctx: { workspace: InviteWorkspace; actor: AuditActor | null; headers?: Headers }
): Promise<AddTeamMembersResult> {
  const principalIds = input.principalIds as PrincipalId[]
  const emails = input.emails.map((e) => e.trim().toLowerCase())
  const total = principalIds.length + emails.length

  if (total === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'Choose at least one person to add')
  }
  if (total > MAX_TEAM_ADDITIONS) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Add at most ${MAX_TEAM_ADDITIONS} people at a time`
    )
  }
  const dupe = firstDuplicate(principalIds) ?? firstDuplicate(emails)
  if (dupe) {
    throw new ValidationError('VALIDATION_ERROR', `${dupe} is listed more than once`)
  }

  const assignedRoleName = await assertInviteGrant(input.role, input.roleId, granter)

  const candidates = new Map(
    (await loadTeamCandidates(principalIds)).map((c) => [c.id as string, c])
  )
  const toPromote = principalIds.map((id) => assertPromotable(id, candidates.get(id), granter))

  for (const email of emails) {
    const item = { email }
    if (!realEmail(email)) {
      throw about(
        new ValidationError('NOT_ELIGIBLE', `${email} cannot receive an invitation`),
        item
      )
    }
    const standing = await classifyInviteEmail(email)
    if (standing.status === 'pending_invite') {
      throw about(
        new ConflictError('INVITE_PENDING', `${email} already has a pending invitation`),
        item
      )
    }
    if (standing.status === 'member') {
      throw about(new ConflictError('ALREADY_MEMBER', `${email} is already on the team`), item)
    }
    if (standing.principalId && candidates.has(standing.principalId)) {
      throw about(
        new ValidationError('VALIDATION_ERROR', `${email} is listed more than once`),
        item
      )
    }
  }

  // Whole-batch seat check before minting anything.
  await assertSeatsAvailable(total)

  const invites: MintedTeamInvite[] = []
  let cacheKeys: string[]
  try {
    for (const email of emails) invites.push(await mintTeamInvite(email))
    cacheKeys = await db.transaction(async (tx) => {
      await assertSeatsAvailable(total, { executor: tx })
      const keys = await promotePortalUsers(tx, toPromote, input.role, {
        assignRoleId: input.roleId,
        grantedBy: granter.principalId,
      })
      for (const invite of invites) {
        await insertTeamInvite(tx, invite, {
          role: input.role,
          roleId: input.roleId,
          inviterId: granter.userId,
        })
      }
      return keys
    })
  } catch (error) {
    // Nothing was committed: retire every link minted for this batch.
    if (invites.length > 0) {
      try {
        const { revokeMagicLinkTokens } = await import('@/lib/server/auth/magic-link-mint')
        await revokeMagicLinkTokens(invites.map((i) => i.magicLinkToken))
      } catch (revokeError) {
        log.error({ err: revokeError }, 'revoking minted invite links failed')
      }
    }
    throw error
  }

  for (const key of cacheKeys) await cacheDel(key)

  if (ctx.actor) {
    for (const person of toPromote) {
      await recordAuditEvent({
        event: 'user.role.changed',
        actor: ctx.actor,
        headers: ctx.headers,
        target: { type: 'principal', id: person.id },
        before: { role: person.role },
        after: {
          role: input.role,
          ...(assignedRoleName ? { assignedRole: assignedRoleName } : {}),
        },
      })
    }
  }

  const invited: AddTeamMembersResult['invited'] = []
  for (const invite of invites) {
    let sent = false
    try {
      sent = (
        await deliverTeamInvite(invite, { inviterName: granter.name, workspace: ctx.workspace })
      ).sent
    } catch (error) {
      log.error({ err: error, invitation_id: invite.invitationId }, 'invitation email failed')
    }
    invited.push({
      email: invite.email,
      invitationId: invite.invitationId,
      emailSent: sent,
      ...(sent ? {} : { inviteLink: invite.inviteLink }),
    })
  }

  return {
    added: toPromote.map((p) => ({ principalId: p.id, name: p.name })),
    invited,
  }
}
