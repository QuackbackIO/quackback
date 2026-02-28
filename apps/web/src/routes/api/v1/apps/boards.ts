import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { handleDomainError } from '@/lib/server/domains/api/responses'
import {
  corsHeaders,
  preflightResponse,
} from '@/lib/server/integrations/apps/cors'

export const Route = createFileRoute('/api/v1/apps/boards')({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),

      GET: async ({ request }) => {
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { listPublicBoardsWithStats } = await import(
            '@/lib/server/domains/boards/board.public'
          )

          const boards = await listPublicBoardsWithStats()

          return new Response(
            JSON.stringify({
              data: {
                boards: boards.map((b) => ({
                  id: b.id,
                  name: b.name,
                  slug: b.slug,
                })),
              },
            }),
            {
              headers: { 'Content-Type': 'application/json', ...corsHeaders() },
            }
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
