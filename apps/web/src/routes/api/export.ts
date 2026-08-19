import { createFileRoute } from '@tanstack/react-router'
import type { Role } from '@/lib/shared/roles'
import { isValidTypeId, type BoardId } from '@quackback/ids'
import { escapeCSV } from '@/lib/server/utils/csv'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'export' })

export const Route = createFileRoute('/api/export')({
  server: {
    handlers: {
      /**
       * GET /api/export
       * Export posts to CSV format
       */
      GET: async ({ request }) => {
        const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
        const { canAccess } = await import('@/lib/server/auth')
        const { listPostsForExport } = await import('@/lib/server/domains/posts/post.export')
        const { getBoardById } = await import('@/lib/server/domains/boards/board.service')

        const url = new URL(request.url)
        const boardIdParam = url.searchParams.get('boardId')
        log.info({ board_id: boardIdParam || 'all' }, 'csv export started')

        try {
          // Validate workspace access
          const validation = await validateApiWorkspaceAccess()
          if (!validation.success) {
            return Response.json({ error: validation.error }, { status: validation.status })
          }

          // Check role - only admin can export
          if (!canAccess(validation.principal.role as Role, ['admin'])) {
            log.warn({ role: validation.principal.role }, 'export access denied')
            return Response.json({ error: 'Only admins can export data' }, { status: 403 })
          }

          // Tier gate: analyticsExports is a Pro+ feature.
          const { assertTierFeature } = await import('@/lib/server/domains/settings/tier-enforce')
          await assertTierFeature('analyticsExports', 'Data export')

          // Validate boardId TypeID format
          let boardId: BoardId | undefined
          if (boardIdParam) {
            if (!isValidTypeId(boardIdParam, 'board')) {
              return Response.json({ error: 'Invalid board ID format' }, { status: 400 })
            }
            boardId = boardIdParam as BoardId
            // Verify board exists (throws NotFoundError if not found)
            try {
              await getBoardById(boardId)
            } catch {
              return Response.json({ error: 'Board not found' }, { status: 400 })
            }
          }

          // Get all posts for export
          const orgPosts = await listPostsForExport(boardId)

          // Build CSV content
          const headers = [
            'title',
            'content',
            'status',
            'tags',
            'board',
            'author_name',
            'author_email',
            'vote_count',
            'created_at',
          ]

          const rows = orgPosts.map((post) => {
            const tagNames = post.tags.map((t) => t.name).join(',')
            const statusSlug = post.statusDetails?.name || ''

            return [
              escapeCSV(post.title),
              escapeCSV(post.content),
              escapeCSV(statusSlug),
              escapeCSV(tagNames),
              escapeCSV(post.board.slug),
              escapeCSV(post.authorName || ''),
              escapeCSV(post.authorEmail || ''),
              String(post.voteCount),
              post.createdAt.toISOString(),
            ]
          })

          // Build CSV string
          const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')

          // Return as downloadable file
          const filename = boardId
            ? `posts-export-${boardId}-${Date.now()}.csv`
            : `posts-export-${validation.settings.slug}-${Date.now()}.csv`

          log.info({ post_count: orgPosts.length }, 'csv export complete')
          return new Response(csvContent, {
            headers: {
              'Content-Type': 'text/csv',
              'Content-Disposition': `attachment; filename="${filename}"`,
            },
          })
        } catch (error) {
          const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
          if (error instanceof TierLimitError) {
            return Response.json(error.toResponseBody(), { status: error.statusCode })
          }
          log.error({ err: error }, 'csv export failed')
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },
    },
  },
})
