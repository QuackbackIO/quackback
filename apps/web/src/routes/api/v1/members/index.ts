import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/api/auth'
import { successResponse, handleDomainError } from '@/lib/api/responses'

export const Route = createFileRoute('/api/v1/members/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/members
       * List all team members (admin and member roles)
       */
      GET: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          // Import service function
          const { listTeamMembers } = await import('@/lib/members/member.service')

          const members = await listTeamMembers()

          return successResponse(
            members.map((m) => ({
              id: m.id,
              userId: m.userId,
              name: m.name,
              email: m.email,
              image: m.image,
              role: m.role,
              createdAt: m.createdAt.toISOString(),
            }))
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
