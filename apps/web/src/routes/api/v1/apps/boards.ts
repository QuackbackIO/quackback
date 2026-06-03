import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { handleDomainError } from '@/lib/server/domains/api/responses'
import { appJsonResponse, preflightResponse } from '@/lib/server/integrations/apps/cors'
import type { Actor } from '@/lib/server/policy'
import type { SegmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/apps/boards')({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),

      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const { listPublicBoardsWithStats } =
            await import('@/lib/server/domains/boards/board.public')

          // Build a service-principal Actor from the API-key auth so
          // listPublicBoardsWithStats uses team-level boardViewFilter.
          // Without this, the default ANONYMOUS_ACTOR makes a team
          // caller see only public boards — the wrong direction.
          // Team callers (admin | member) short-circuit on isTeamActor,
          // so segmentIds don't matter; pass an empty set.
          const actor: Actor = {
            principalId: auth.principalId,
            role: auth.role,
            principalType: 'service',
            segmentIds: new Set<SegmentId>(),
          }
          const boards = await listPublicBoardsWithStats(actor)

          return appJsonResponse({
            boards: boards.map((b) => ({
              id: b.id,
              name: b.name,
              slug: b.slug,
            })),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
