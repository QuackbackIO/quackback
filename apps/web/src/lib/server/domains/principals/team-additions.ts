/**
 * Adding people to the team from the members page in one batch: people who
 * already sign in to the portal join immediately; email addresses get an
 * invitation. The batch is validated as a whole (eligibility, duplicates,
 * pending invites, the grant ceiling and the seat count) before anything is
 * written, and written in one transaction. The picker query lives in
 * people-to-add.ts.
 */
import { and, db, eq, inArray, invitation, sql, user } from '@/lib/server/db'
import type { InviteId, PrincipalId, RoleId, UserId } from '@quackback/ids'
import { ConflictError, ValidationError } from '@/lib/shared/errors'
import { realEmail } from '@/lib/shared/anonymous-email'
import { recordAuditEvent, type AuditActor } from '@/lib/server/audit/log'
import { cacheDel } from '@/lib/server/cache'
import { logger } from '@/lib/server/logger'
import { assertSeatsAvailable, lockSeatLedger } from './seat-limit'
import { mapWithConcurrency } from '@/lib/server/utils/concurrency'
import {
  classifyTeamCandidate,
  loadTeamCandidates,
  promotePortalUsers,
  retirePendingInvitesFor,
  revokeRetiredInviteTokens,
  type TeamCandidate,
} from './team-promotion'
import {
  assertInviteGrant,
  classifyInviteEmails,
  deliverTeamInvite,
  insertTeamInvites,
  type TeamInviteCopy,
  mintTeamInvites,
  type InviteEmailStatus,
  type InviteWorkspace,
  type MintedTeamInvite,
  type TeamGranter,
} from './team-invitation'

const log = logger.child({ component: 'team-additions' })

/** Most people (ids plus emails) one add request may carry. */
export const MAX_TEAM_ADDITIONS = 50
/** Invitation emails sent at once after commit. */
const SEND_CONCURRENCY = 5

/** How many of these people already hold a seat through a pending team invite to their email. */
async function countPendingInvitesFor(people: readonly TeamCandidate[]): Promise<number> {
  const userIds = people.map((p) => p.userId).filter((id): id is UserId => id != null)
  if (userIds.length === 0) return 0
  const rows = await db
    .selectDistinct({ userId: user.id })
    .from(user)
    .innerJoin(invitation, sql`lower(${invitation.email}) = lower(${user.email})`)
    .where(
      and(
        inArray(user.id, userIds),
        eq(invitation.kind, 'team'),
        eq(invitation.status, 'pending'),
        sql`${invitation.expiresAt} > now()`
      )
    )
  return rows.length
}

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

/** Refuse emails a pending invite or a teammate already covers; run before and under the lock. */
function assertEmailsInvitable(
  emails: readonly string[],
  standings: Map<string, InviteEmailStatus>,
  promoting: ReadonlySet<string>
): void {
  for (const email of emails) {
    const item = { email }
    const standing = standings.get(email)
    if (standing?.status === 'pending_invite') {
      throw about(
        new ConflictError('INVITE_PENDING', `${email} already has a pending invitation`),
        item
      )
    }
    if (standing?.status === 'member') {
      throw about(new ConflictError('ALREADY_MEMBER', `${email} is already on the team`), item)
    }
    if (standing?.principalId && promoting.has(standing.principalId)) {
      throw about(
        new ValidationError('VALIDATION_ERROR', `${email} is listed more than once`),
        item
      )
    }
  }
}

/**
 * Add people to the team in one go: `principalIds` (portal users who have
 * signed in) join at once, `emails` are invited. Everything is validated
 * before any write. The write transaction takes the seat-ledger lock, then
 * re-checks the emails (a racing add cannot leave two pending invites for one
 * address), retires any pending team invite addressed to a person joining
 * directly (its seat is the one they take), checks seats for the whole batch
 * and writes. Promotions are audited as user.role.changed. Invitation mail
 * goes out after commit, a few at a time; a send failure does not undo the
 * batch and is reported per invite.
 */
export async function addTeamMembers(
  input: AddTeamMembersInput,
  granter: TeamGranter,
  ctx: {
    workspace: InviteWorkspace
    actor: AuditActor | null
    headers?: Headers
    /** The invitation's wording in the team's language, made once per batch. */
    invitationCopy?: TeamInviteCopy
  }
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
  const promoting = new Set<string>(principalIds)

  for (const email of emails) {
    if (!realEmail(email)) {
      throw about(new ValidationError('NOT_ELIGIBLE', `${email} cannot receive an invitation`), {
        email,
      })
    }
  }
  assertEmailsInvitable(emails, await classifyInviteEmails(emails), promoting)

  // Whole-batch seat check before minting anything. A pending invite for a
  // person joining directly already holds their seat.
  const holding = await countPendingInvitesFor(toPromote)
  await assertSeatsAvailable(total - holding)

  const minted: MintedTeamInvite[] = []
  let written: { cacheKeys: string[]; retiredTokens: string[] }
  try {
    const invites = await mintTeamInvites(emails, (invite) => minted.push(invite))
    written = await db.transaction(async (tx) => {
      await lockSeatLedger(tx)
      assertEmailsInvitable(emails, await classifyInviteEmails(emails, tx), promoting)
      const retiredTokens = await retirePendingInvitesFor(
        tx,
        toPromote.map((p) => p.userId as UserId)
      )
      await assertSeatsAvailable(total, { executor: tx })
      const cacheKeys = await promotePortalUsers(tx, toPromote, input.role, {
        assignRoleId: input.roleId,
        grantedBy: granter.principalId,
      })
      await insertTeamInvites(tx, invites, {
        role: input.role,
        roleId: input.roleId,
        inviterId: granter.userId,
      })
      return { cacheKeys, retiredTokens }
    })
  } catch (error) {
    // Nothing was committed: retire every link minted for this batch.
    await revokeRetiredInviteTokens(minted.map((i) => i.magicLinkToken))
    throw error
  }

  for (const key of written.cacheKeys) await cacheDel(key)
  await revokeRetiredInviteTokens(written.retiredTokens)

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

  const invited: AddTeamMembersResult['invited'] = new Array(minted.length)
  const ordered = emails.map((email) => minted.find((m) => m.email === email)!)
  await mapWithConcurrency(ordered, SEND_CONCURRENCY, async (invite, i) => {
    let sent = false
    try {
      sent = (
        await deliverTeamInvite(invite, {
          inviterName: granter.name,
          workspace: ctx.workspace,
          copy: ctx.invitationCopy,
        })
      ).sent
    } catch (error) {
      log.error({ err: error, invitation_id: invite.invitationId }, 'invitation email failed')
    }
    invited[i] = {
      email: invite.email,
      invitationId: invite.invitationId,
      emailSent: sent,
      ...(sent ? {} : { inviteLink: invite.inviteLink }),
    }
  })

  return {
    added: toPromote.map((p) => ({ principalId: p.id, name: p.name })),
    invited,
  }
}
