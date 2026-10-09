/**
 * Server functions behind the members page "Add people" dialog: find people
 * to add, add a batch (signed-in portal users join at once, emails are
 * invited), change a teammate's role, and the seat summary the dialog
 * shows. Undo of a join is removeTeamMemberFn in ./admin.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { PrincipalId, RoleId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DomainException } from '@/lib/shared/errors'
import {
  ADD_REFUSAL_CODES,
  CHANGE_ROLE_REFUSAL_CODES,
  type AddRefusalCode,
  type ChangeRoleRefusalCode,
} from '@/lib/shared/team-people'
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

export type AddTeamMembersRefusalCode = AddRefusalCode

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
    const { invitationCopyForRequest } =
      await import('@/lib/server/domains/onboarding/onboarding-email-copy')

    try {
      const result = await addTeamMembers(
        {
          principalIds: data.principalIds,
          emails: data.emails,
          role: data.role,
          roleId: data.roleId as RoleId | undefined,
        },
        teamGranterFromAuth(auth),
        {
          workspace: auth.settings,
          actor: actorFromAuth(auth),
          headers: getRequestHeaders(),
          invitationCopy:
            data.emails.length > 0
              ? await invitationCopyForRequest(auth.user.name, null, auth.settings.name)
              : undefined,
        }
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

const changeTeamRoleSchema = z.object({
  principalId: z.string(),
  role: z.enum(['admin', 'member']),
  // Custom-role grant; rides role='member'. Validated in the service.
  roleId: z.string().optional(),
})

export interface ChangeTeamRoleRefusal {
  ok: false
  code: ChangeRoleRefusalCode
  message: string
}

/** Service codes reported under a different refusal code. */
const CHANGE_ROLE_CODE_ALIASES: Record<string, ChangeRoleRefusalCode> = {
  MEMBER_NOT_FOUND: 'NOT_FOUND',
  ROLE_NOT_FOUND: 'NOT_FOUND',
}

function toChangeRoleRefusal(error: unknown): ChangeTeamRoleRefusal | null {
  if (!(error instanceof DomainException)) return null
  const code =
    CHANGE_ROLE_CODE_ALIASES[error.code] ?? CHANGE_ROLE_REFUSAL_CODES.find((c) => c === error.code)
  return code ? { ok: false, code, message: error.message } : null
}

/**
 * Change a teammate's role, or add a signed-in portal user with one. The same
 * rules as the add dialog: only an admin grants Admin or changes an admin, a
 * custom role stays within the caller's own permissions, the last admin
 * stays, and joining takes a seat. Expected refusals come back as
 * `{ ok: false, code, message }`; anything unexpected throws.
 */
export const changeTeamRoleFn = createServerFn({ method: 'POST' })
  .validator(changeTeamRoleSchema)
  .handler(async ({ data }) => {
    log.info({ principal_id: data.principalId, role: data.role }, 'change team role')
    const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_MANAGE })
    const { actorFromAuth } = await import('@/lib/server/audit/log')
    const { updateMemberRole } = await import('@/lib/server/domains/principals/principal.service')
    try {
      const result = await updateMemberRole(
        data.principalId as PrincipalId,
        data.role,
        auth.principal.id,
        actorFromAuth(auth),
        getRequestHeaders(),
        {
          assignRoleId: data.roleId as RoleId | undefined,
          granterPermissions: auth.permissions,
          granterRole: auth.principal.role,
        }
      )
      return { ok: true as const, ...result }
    } catch (error) {
      const refusal = toChangeRoleRefusal(error)
      if (!refusal) throw error
      log.info({ code: refusal.code }, 'change team role refused')
      return refusal
    }
  })
