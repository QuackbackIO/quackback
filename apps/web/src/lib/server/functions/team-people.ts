/**
 * Server functions behind the members page "Add people" dialog: find people
 * to add, add a batch (signed-in portal users join at once, emails are
 * invited), and the seat summary the dialog shows. Undo of a join is
 * removeTeamMemberFn in ./admin.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { RoleId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DomainException } from '@/lib/shared/errors'
import { requireAuth } from './auth-helpers'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'team-people' })

const searchPeopleToAddSchema = z.object({
  query: z.string().max(200),
})

/**
 * People the caller can add to the team. Gated on member.manage (adding is
 * the point); listing portal users additionally needs people.view, reported
 * back as `canSearchPeople` (false: `people` is always empty).
 */
export const searchPeopleToAddFn = createServerFn({ method: 'GET' })
  .validator(searchPeopleToAddSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_MANAGE })
    const { findPeopleToAdd } = await import('@/lib/server/domains/principals/people-to-add')
    return findPeopleToAdd({
      query: data.query,
      callerPrincipalId: auth.principal.id,
      canSearchPeople: auth.permissions.includes(PERMISSIONS.PEOPLE_VIEW),
    })
  })

const addTeamMembersSchema = z.object({
  principalIds: z.array(z.string()).max(50),
  emails: z.array(z.string().email()).max(50),
  role: z.enum(['admin', 'member']),
  // Custom-role grant; rides role='member'. Validated in the service.
  roleId: z.string().optional(),
})

const ADD_REFUSAL_CODES = [
  'SEAT_LIMIT',
  'GRANT_CEILING',
  'ALREADY_MEMBER',
  'INVITE_PENDING',
  'NOT_ELIGIBLE',
  'VALIDATION_ERROR',
] as const
export type AddTeamMembersRefusalCode = (typeof ADD_REFUSAL_CODES)[number]

export interface AddTeamMembersRefusal {
  ok: false
  code: AddTeamMembersRefusalCode
  message: string
  /** SEAT_LIMIT: seats the request needs and seats free. */
  needed?: number
  free?: number
  /** The email or person the refusal is about, when it is about one. */
  email?: string
  principalId?: string
}

/** An expected refusal from the add service as a value, or null for anything else. */
function toAddRefusal(error: unknown): AddTeamMembersRefusal | null {
  if (!(error instanceof DomainException)) return null
  const code = ADD_REFUSAL_CODES.find((c) => c === error.code)
  if (!code) return null
  const detail = error as DomainException & {
    needed?: number
    free?: number
    email?: string
    principalId?: string
  }
  return {
    ok: false,
    code,
    message: error.message,
    ...(detail.needed !== undefined ? { needed: detail.needed } : {}),
    ...(detail.free !== undefined ? { free: detail.free } : {}),
    ...(detail.email ? { email: detail.email } : {}),
    ...(detail.principalId ? { principalId: detail.principalId } : {}),
  }
}

/**
 * Add people to the team in one request: signed-in portal users join at once
 * (audited as user.role.changed), email addresses are invited. The whole
 * batch is validated (eligibility, pending invites, grant ceiling, seats)
 * before anything is written. Expected refusals come back as
 * `{ ok: false, code, message, ... }` rather than thrown, because a typed
 * error thrown from a server function does not reliably reach the client
 * with its code; anything unexpected still throws.
 */
export const addTeamMembersFn = createServerFn({ method: 'POST' })
  .validator(addTeamMembersSchema)
  .handler(async ({ data }) => {
    log.info(
      { people: data.principalIds.length, invites: data.emails.length, role: data.role },
      'add team members'
    )
    const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_MANAGE })
    const { actorFromAuth } = await import('@/lib/server/audit/log')
    const { teamGranterFromAuth } = await import('@/lib/server/domains/principals/team-invitation')
    const { addTeamMembers } = await import('@/lib/server/domains/principals/team-additions')

    try {
      const result = await addTeamMembers(
        {
          principalIds: data.principalIds,
          emails: data.emails,
          role: data.role,
          roleId: data.roleId as RoleId | undefined,
        },
        teamGranterFromAuth(auth),
        { workspace: auth.settings, actor: actorFromAuth(auth), headers: getRequestHeaders() }
      )
      log.info({ added: result.added.length, invited: result.invited.length }, 'team members added')
      return { ok: true as const, ...result }
    } catch (error) {
      const refusal = toAddRefusal(error)
      if (!refusal) throw error
      log.info({ code: refusal.code }, 'add team members refused')
      return refusal
    }
  })

/**
 * Seats in use (members plus pending team invites) and the plan's cap; a
 * null limit means unlimited.
 */
export const getTeamSeatsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const { countSeatUsage } = await import('@/lib/server/domains/principals/seat-usage')
  const [limits, seats] = await Promise.all([getTierLimits(), countSeatUsage()])
  return { used: seats.used, limit: limits.maxTeamSeats }
})
