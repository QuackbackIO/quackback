import { createFileRoute } from '@tanstack/react-router'
import { listPublicPosts } from '@/lib/server/domains/posts/post.public'

export const Route = createFileRoute('/api/widget/search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const q = url.searchParams.get('q')?.trim()
        const board = url.searchParams.get('board') || undefined
        const limit = Math.min(Number(url.searchParams.get('limit')) || 5, 20)

        if (!q) {
          return Response.json({ data: { posts: [] } }, { headers: corsHeaders() })
        }

        try {
          const result = await listPublicPosts({
            search: q,
            boardSlug: board,
            sort: 'top',
            limit,
            page: 1,
          })

          const posts = result.items
            .filter((p) => p.board)
            .map((p) => ({
              id: p.id,
              title: p.title,
              voteCount: p.voteCount,
              statusId: p.statusId,
              commentCount: p.commentCount,
              board: { id: p.board!.id, name: p.board!.name, slug: p.board!.slug },
            }))

          return Response.json({ data: { posts } }, { headers: corsHeaders() })
        } catch (error) {
          console.error('[widget:search] Error:', error)
          return Response.json(
            { error: { code: 'SERVER_ERROR', message: 'Search failed' } },
            { status: 500, headers: corsHeaders() }
          )
        }
      },
    },
  },
})

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  }
}
