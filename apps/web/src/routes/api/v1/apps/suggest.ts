import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { badRequestResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { fromUuid } from '@quackback/ids'
import {
  corsHeaders,
  preflightResponse,
} from '@/lib/server/integrations/apps/cors'

export const Route = createFileRoute('/api/v1/apps/suggest')({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),

      GET: async ({ request }) => {
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const url = new URL(request.url)
          const text = url.searchParams.get('text')?.trim()
          const limit = Math.min(Number(url.searchParams.get('limit')) || 5, 20)

          if (!text) {
            return badRequestResponse('text parameter is required')
          }

          const { generateEmbedding } = await import(
            '@/lib/server/domains/embeddings/embedding.service'
          )
          const { findSimilarPosts } = await import(
            '@/lib/server/domains/feedback/pipeline/embedding.service'
          )

          const embedding = await generateEmbedding(text)

          if (!embedding) {
            // AI not configured - fall back to text search
            const { listPublicPosts } = await import(
              '@/lib/server/domains/posts/post.public'
            )
            const result = await listPublicPosts({
              search: text.slice(0, 100),
              sort: 'top',
              limit,
              page: 1,
            })
            const posts = result.items.map((p) => ({
              id: p.id,
              title: p.title,
              voteCount: p.voteCount,
              similarity: null,
              board: p.board ? { name: p.board.name } : { name: '' },
            }))
            return new Response(JSON.stringify({ data: { posts } }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders() },
            })
          }

          const similar = await findSimilarPosts(embedding, {
            limit,
            minSimilarity: 0.5,
          })

          const posts = similar.map((p) => ({
            id: fromUuid('post', p.id),
            title: p.title,
            voteCount: p.voteCount,
            similarity: Math.round(p.similarity * 100) / 100,
            board: { name: p.boardName ?? '' },
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
