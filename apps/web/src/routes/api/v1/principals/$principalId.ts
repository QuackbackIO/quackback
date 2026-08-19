import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { NotFoundError } from '@/lib/shared/errors'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { isValidTypeId } from '@quackback/ids'
import type { PrincipalId, RoleId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'
import { PERMISSIONS } from '@/lib/shared/permissions'

// Input validation schema for updating member role
const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
  /** Custom-role grant; rides role='member'. Validated in the service. */
  roleId: z
    .string()
    .refine((v) => isValidTypeId(v, 'role'), 'Invalid role id')
    .optional(),
})

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
  }
}

export const Route = createFileRoute('/api/v1/principals/$principalId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/principals/:principalId
       * Get a single team member by ID
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.MEMBER_VIEW })

          const principalId = parseTypeId<PrincipalId>(
            params.principalId,
            'principal',
            'principal ID'
          )

          const result = await fetchTeamMemberWithUser(principalId)

          return successResponse(result)
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/principals/:principalId
       * Update a team member's role
       */
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.MEMBER_MANAGE,
          })
          const actingPrincipalId = auth.principalId

          const principalId = parseTypeId<PrincipalId>(
            params.principalId,
            'principal',
            'principal ID'
          )

          const body = await request.json()
          const parsed = updateMemberSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { updateMemberRole } =
            await import('@/lib/server/domains/principals/principal.service')

          const { resolveActorPermissions } = await import('@/lib/server/policy/permissions')
          await updateMemberRole(
            principalId,
            parsed.data.role,
            actingPrincipalId,
            null,
            undefined,
            {
              assignRoleId: parsed.data.roleId as RoleId | undefined,
              // API keys carry the owner-preset authority model; the ceiling for
              // an assignment grant is the key owner's resolved set.
              granterPermissions: [...resolveActorPermissions(auth.role)],
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
      DELETE: async ({ request, params }) => {
        try {
          const { principalId: actingPrincipalId } = await withApiKeyAuth(request, {
            permission: PERMISSIONS.MEMBER_MANAGE,
          })

          const principalId = parseTypeId<PrincipalId>(
            params.principalId,
            'principal',
            'principal ID'
          )

          const { removeTeamMember } =
            await import('@/lib/server/domains/principals/principal.service')

          await removeTeamMember(principalId, actingPrincipalId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
