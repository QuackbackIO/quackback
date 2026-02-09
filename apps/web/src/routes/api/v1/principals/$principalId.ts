import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId } from '@/lib/server/domains/api/validation'
import type { PrincipalId } from '@quackback/ids'

// Input validation schema for updating member role
const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
})

/** Fetch a team member with user details, or return a notFoundResponse. */
async function fetchTeamMemberWithUser(principalId: PrincipalId) {
  const { getMemberById } = await import('@/lib/server/domains/principals/principal.service')
  const { db, eq, user } = await import('@/lib/server/db')

  const member = await getMemberById(principalId)
  if (!member) return notFoundResponse('Member not found')
  if (member.role !== 'admin' && member.role !== 'member') {
    return notFoundResponse('Team member not found')
  }
  if (!member.userId) return notFoundResponse('User not found')

  const userDetails = await db.query.user.findFirst({
    where: eq(user.id, member.userId),
  })
  if (!userDetails) return notFoundResponse('User not found')

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
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { principalId } = params

          // Validate TypeID format
          const validationError = validateTypeId(principalId, 'principal', 'principal ID')
          if (validationError) return validationError

          const result = await fetchTeamMemberWithUser(principalId as PrincipalId)
          if (result instanceof Response) return result

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
        // Authenticate (admin only)
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult
        const { principalId: actingPrincipalId } = authResult

        try {
          const { principalId } = params

          // Validate TypeID format
          const validationError = validateTypeId(principalId, 'principal', 'principal ID')
          if (validationError) return validationError

          // Parse and validate body
          const body = await request.json()
          const parsed = updateMemberSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { updateMemberRole } =
            await import('@/lib/server/domains/principals/principal.service')

          await updateMemberRole(principalId as PrincipalId, parsed.data.role, actingPrincipalId)

          const result = await fetchTeamMemberWithUser(principalId as PrincipalId)
          if (result instanceof Response) return result

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
        // Authenticate (admin only)
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult
        const { principalId: actingPrincipalId } = authResult

        try {
          const { principalId } = params

          // Validate TypeID format
          const validationError = validateTypeId(principalId, 'principal', 'principal ID')
          if (validationError) return validationError

          // Import service function
          const { removeTeamMember } =
            await import('@/lib/server/domains/principals/principal.service')

          await removeTeamMember(principalId as PrincipalId, actingPrincipalId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
