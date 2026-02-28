import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import {
  corsHeaders,
  preflightResponse,
} from '@/lib/server/integrations/apps/cors'

export const Route = createFileRoute('/api/v1/apps/search')({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),

      GET: async ({ request }) => {
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const url = new URL(request.url)
          const q = url.searchParams.get('q')?.trim()
          const limit = Math.min(Number(url.searchParams.get('limit')) || 10, 20)

          if (!q) {
            return successResponse({ posts: [] })
          }

          const { listPublicPosts } = await import(
            '@/lib/server/domains/posts/post.public'
          )

          const result = await listPublicPosts({
            search: q,
            sort: 'top',
            limit,
            page: 1,
          })

          const posts = result.items.map((p) => ({
            id: p.id,
            title: p.title,
            voteCount: p.voteCount,
            statusName: null as string | null,
            statusColor: null as string | null,
            board: p.board ? { name: p.board.name } : { name: '' },
          }))

          return new Response(JSON.stringify({ data: { posts } }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
