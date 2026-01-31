import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/api/responses'
import { validateTypeId } from '@/lib/api/validation'
import type { MemberId } from '@quackback/ids'

// Input validation schema for updating member role
const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
})

export const Route = createFileRoute('/api/v1/members/$memberId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/members/:memberId
       * Get a single team member by ID
       */
      GET: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { memberId } = params

          // Validate TypeID format
          const validationError = validateTypeId(memberId, 'member', 'member ID')
          if (validationError) return validationError

          // Import service functions
          const { getMemberById } = await import('@/lib/members/member.service')
          const { db, eq, user } = await import('@/lib/db')

          const foundMember = await getMemberById(memberId as MemberId)

          if (!foundMember) {
            return notFoundResponse('Member not found')
          }

          // Only return team members (admin or member role)
          if (foundMember.role !== 'admin' && foundMember.role !== 'member') {
            return notFoundResponse('Team member not found')
          }

          // Get user details
          const userDetails = await db.query.user.findFirst({
            where: eq(user.id, foundMember.userId),
          })

          if (!userDetails) {
            return notFoundResponse('User not found')
          }

          return successResponse({
            id: foundMember.id,
            userId: foundMember.userId,
            role: foundMember.role,
            name: userDetails.name,
            email: userDetails.email,
            image: userDetails.image,
            createdAt: foundMember.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/members/:memberId
       * Update a team member's role
       */
      PATCH: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult
        const { memberId: actingMemberId } = authResult

        try {
          const { memberId } = params

          // Validate TypeID format
          const validationError = validateTypeId(memberId, 'member', 'member ID')
          if (validationError) return validationError

          // Parse and validate body
          const body = await request.json()
          const parsed = updateMemberSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service functions
          const { updateMemberRole, getMemberById } = await import('@/lib/members/member.service')
          const { db, eq, user } = await import('@/lib/db')

          await updateMemberRole(memberId as MemberId, parsed.data.role, actingMemberId)

          // Fetch updated member
          const updatedMember = await getMemberById(memberId as MemberId)

          if (!updatedMember) {
            return notFoundResponse('Member not found')
          }

          // Get user details
          const userDetails = await db.query.user.findFirst({
            where: eq(user.id, updatedMember.userId),
          })

          if (!userDetails) {
            return notFoundResponse('User not found')
          }

          return successResponse({
            id: updatedMember.id,
            userId: updatedMember.userId,
            role: updatedMember.role,
            name: userDetails.name,
            email: userDetails.email,
            image: userDetails.image,
            createdAt: updatedMember.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/members/:memberId
       * Remove a team member (converts them to a portal user)
       */
      DELETE: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult
        const { memberId: actingMemberId } = authResult

        try {
          const { memberId } = params

          // Validate TypeID format
          const validationError = validateTypeId(memberId, 'member', 'member ID')
          if (validationError) return validationError

          // Import service function
          const { removeTeamMember } = await import('@/lib/members/member.service')

          await removeTeamMember(memberId as MemberId, actingMemberId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
