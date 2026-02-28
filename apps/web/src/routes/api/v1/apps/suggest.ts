import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { badRequestResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { fromUuid } from '@quackback/ids'
import { db, posts, boards } from '@/lib/server/db'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { appJsonResponse, preflightResponse } from '@/lib/server/integrations/apps/cors'

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

          const { generateEmbedding } =
            await import('@/lib/server/domains/embeddings/embedding.service')

          const embedding = await generateEmbedding(text)

          if (!embedding) {
            // AI not configured - fall back to text search
            const { listPublicPosts } = await import('@/lib/server/domains/posts/post.public')
            const result = await listPublicPosts({
              search: text.slice(0, 100),
              sort: 'top',
              limit,
              page: 1,
            })
            const resultPosts = result.items.map((p) => ({
              id: p.id,
              title: p.title,
              voteCount: p.voteCount,
              similarity: null,
              board: { name: p.board?.name ?? '' },
            }))
            return appJsonResponse({ posts: resultPosts })
          }

          // Vector similarity search across all boards
          const vectorStr = `[${embedding.join(',')}]`
          const minSimilarity = 0.5

          const similar = await db
            .select({
              id: posts.id,
              title: posts.title,
              voteCount: posts.voteCount,
              similarity: sql<number>`1 - (${posts.embedding} <=> ${vectorStr}::vector)`.as(
                'similarity'
              ),
              boardName: boards.name,
            })
            .from(posts)
            .innerJoin(boards, eq(boards.id, posts.boardId))
            .where(
              and(
                isNull(posts.deletedAt),
                sql`${posts.embedding} IS NOT NULL`,
                sql`1 - (${posts.embedding} <=> ${vectorStr}::vector) >= ${minSimilarity}`
              )
            )
            .orderBy(desc(sql`1 - (${posts.embedding} <=> ${vectorStr}::vector)`))
            .limit(limit)

          const resultPosts = similar.map((p) => ({
            id: fromUuid('post', p.id),
            title: p.title,
            voteCount: p.voteCount,
            similarity: Math.round(Number(p.similarity) * 100) / 100,
            board: { name: p.boardName ?? '' },
          }))

          return appJsonResponse({ posts: resultPosts })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
