import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { isValidTypeId } from '@quackback/ids'
import type { PrincipalId, RoleId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { readJsonBody } from '@/lib/server/domains/api/request'

// Input validation schema for updating member role
const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
  /** Custom-role grant; rides role='member'. Validated in the service. */
  roleId: z
    .string()
    .refine((v) => isValidTypeId(v, 'role'), 'Invalid role id')
    .optional(),
})

type ApiAuth = Awaited<ReturnType<typeof withApiKeyAuth>>

/** The audit actor for a change made with an API key: the key owner, as a key. */
function apiKeyActor(auth: ApiAuth) {
  return {
    userId: auth.principal?.userId ?? null,
    email: auth.principal?.user?.email ?? null,
    role: auth.role,
    type: 'api_key' as const,
    authMethod: 'api_key' as const,
  }
}

/**
 * The person a key acts for: the creator of a personal key, who must not use
 * it to change or remove themselves any more than they can in the app. A
 * workspace key belongs to nobody, and its own service principal is never a
 * teammate, so the service's own self check covers it.
 */
function keyPerson(auth: ApiAuth): PrincipalId | null {
  if (auth.apiKey.kind === 'workspace') return null
  return auth.apiKey.createdById ?? null
}

/** Fetch a team member with user details, or throw NotFoundError. */
async function fetchTeamMemberWithUser(principalId: PrincipalId) {
  const { getMemberById } = await import('@/lib/server/domains/principals/principal.service')
  const { db, eq, user } = await import('@/lib/server/db')

  const member = await getMemberById(principalId)
  if (!member) throw new NotFoundError('MEMBER_NOT_FOUND', 'Member not found')
  if (!isTeamMember(member.role)) {
    throw new NotFoundError('MEMBER_NOT_FOUND', 'Team member not found')
  }
  if (!member.userId) throw new NotFoundError('USER_NOT_FOUND', 'User not found')

  const userDetails = await db.query.user.findFirst({
    where: eq(user.id, member.userId),
  })
  if (!userDetails) throw new NotFoundError('USER_NOT_FOUND', 'User not found')

  return {
    id: member.id,
    userId: member.userId,
    role: member.role,
    name: userDetails.name,
    email: userDetails.email,
    image: userDetails.image,
    createdAt: member.createdAt.toISOString(),
    language: { chosen: userDetails.preferredLanguage, detected: userDetails.detectedLocale },
  }
}

type PrincipalRouteArgs = { request: Request; params: { principalId: string } }

/** Handlers shared with the deprecated /api/v1/members/$principalId alias. */
export const principalHandlers = {
  /**
   * GET /api/v1/principals/:principalId
   * Get a single team member by ID
   */
  GET: async ({ request, params }: PrincipalRouteArgs) => {
    try {
      await withApiKeyAuth(request, { permission: PERMISSIONS.MEMBER_VIEW })

      const principalId = parseTypeId<PrincipalId>(params.principalId, 'principal', 'principal ID')

      const result = await fetchTeamMemberWithUser(principalId)

      return successResponse(result)
    } catch (error) {
      return handleDomainError(error)
    }
  },

  /**
   * PATCH /api/v1/principals/:principalId
   * Update a team member's role, or add a portal user who has signed in
   * to the team (takes a seat). Only an admin key grants the Admin role.
   */
  PATCH: async ({ request, params }: PrincipalRouteArgs) => {
    try {
      const auth = await withApiKeyAuth(request, {
        permission: PERMISSIONS.MEMBER_MANAGE,
      })
      const actingPrincipalId = auth.principalId

      const principalId = parseTypeId<PrincipalId>(params.principalId, 'principal', 'principal ID')
      if (principalId === keyPerson(auth)) {
        throw new ForbiddenError('CANNOT_MODIFY_SELF', 'You cannot change your own role')
      }

      const body = await readJsonBody(request)
      const parsed = updateMemberSchema.safeParse(body)

      if (!parsed.success) {
        return badRequestResponse('Invalid request body', {
          errors: parsed.error.flatten().fieldErrors,
        })
      }

      const { updateMemberRole } = await import('@/lib/server/domains/principals/principal.service')

      await updateMemberRole(
        principalId,
        parsed.data.role,
        actingPrincipalId,
        apiKeyActor(auth),
        request.headers,
        {
          assignRoleId: parsed.data.roleId as RoleId | undefined,
          // The ceiling for an assignment grant is the key's resolved set
          // (its preset capped at its creator's current permissions), and
          // the Admin role needs a key whose role is still admin.
          granterPermissions: [...auth.permissions],
          granterRole: auth.role,
        }
      )

      const result = await fetchTeamMemberWithUser(principalId)

      return successResponse(result)
    } catch (error) {
      return handleDomainError(error)
    }
  },

  /**
   * DELETE /api/v1/principals/:principalId
   * Remove a team member (converts them to a portal user)
   */
  DELETE: async ({ request, params }: PrincipalRouteArgs) => {
    try {
      const auth = await withApiKeyAuth(request, {
        permission: PERMISSIONS.MEMBER_MANAGE,
      })

      const principalId = parseTypeId<PrincipalId>(params.principalId, 'principal', 'principal ID')
      if (principalId === keyPerson(auth)) {
        throw new ForbiddenError('CANNOT_REMOVE_SELF', 'You cannot remove yourself from the team')
      }

      const { removeTeamMember } = await import('@/lib/server/domains/principals/principal.service')

      await removeTeamMember(principalId, auth.principalId, apiKeyActor(auth), request.headers, {
        granterRole: auth.role,
      })

      return noContentResponse()
    } catch (error) {
      return handleDomainError(error)
    }
  },
}

export const Route = createFileRoute('/api/v1/principals/$principalId')({
  server: { handlers: principalHandlers },
})
