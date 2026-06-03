import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { handleDomainError } from '@/lib/server/domains/api/responses'
import { appJsonResponse, preflightResponse } from '@/lib/server/integrations/apps/cors'
import type { Actor } from '@/lib/server/policy'
import type { SegmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/apps/search')({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),

      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const url = new URL(request.url)
          const q = url.searchParams.get('q')?.trim()
          const limit = Math.min(Number(url.searchParams.get('limit')) || 10, 20)

          if (!q) {
            return appJsonResponse({ posts: [] })
          }

          const { listPublicPosts } = await import('@/lib/server/domains/posts/post.public')

          // Build a service-principal Actor from the API-key auth so
          // listPublicPosts uses team-level postViewFilter. Without
          // this, the default ANONYMOUS_ACTOR makes a team caller see
          // only public-board posts — the wrong direction. Team
          // callers (admin | member) short-circuit on isTeamActor, so
          // segmentIds don't matter; pass an empty set.
          const actor: Actor = {
            principalId: auth.principalId,
            role: auth.role,
            principalType: 'service',
            segmentIds: new Set<SegmentId>(),
          }
          const result = await listPublicPosts({
            search: q,
            sort: 'top',
            limit,
            page: 1,
            actor,
          })

          const posts = result.items.map((p) => ({
            id: p.id,
            title: p.title,
            voteCount: p.voteCount,
            statusName: null as string | null,
            statusColor: null as string | null,
            board: p.board ? { name: p.board.name } : { name: '' },
          }))

          return appJsonResponse({ posts })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
