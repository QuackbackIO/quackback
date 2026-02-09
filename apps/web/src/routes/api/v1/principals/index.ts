import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'

export const Route = createFileRoute('/api/v1/principals/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/principals
       * List all team members (admin and member roles)
       */
      GET: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          // Import service function
          const { listTeamMembers } =
            await import('@/lib/server/domains/principals/principal.service')

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
