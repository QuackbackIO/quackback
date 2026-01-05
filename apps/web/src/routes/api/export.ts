import { createFileRoute } from '@tanstack/react-router'
import { isValidTypeId, type BoardId } from '@quackback/ids'

/**
 * Escape a value for CSV format, preventing CSV injection attacks
 */
function escapeCSV(value: string): string {
  if (!value) return '""'

  // Prevent CSV injection by prefixing formula characters with single quote
  let escaped = value
  if (/^[=+\-@\t\r]/.test(escaped)) {
    escaped = "'" + escaped
  }

  // If the value contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
  if (
    escaped.includes('"') ||
    escaped.includes(',') ||
    escaped.includes('\n') ||
    escaped.includes('\r')
  ) {
    return `"${escaped.replace(/"/g, '""')}"`
  }

  return `"${escaped}"`
}

export const Route = createFileRoute('/api/export')({
  server: {
    handlers: {
      /**
       * GET /api/export
       * Export posts to CSV format
       */
      GET: async ({ request }) => {
        const { validateApiWorkspaceAccess } = await import('@/lib/server-functions/workspace')
        const { canAccess } = await import('@/lib/auth')
        type Role = 'admin' | 'member' | 'user'
        const { listPostsForExport } = await import('@/lib/posts/post.service')
        const { getBoardById } = await import('@/lib/boards/board.service')

        const url = new URL(request.url)
        const boardIdParam = url.searchParams.get('boardId')
        console.log(`[export] 📦 Starting CSV export: boardId=${boardIdParam || 'all'}`)

        try {
          // Validate workspace access
          const validation = await validateApiWorkspaceAccess()
          if (!validation.success) {
            return Response.json({ error: validation.error }, { status: validation.status })
          }

          // Check role - only admin can export
          if (!canAccess(validation.member.role as Role, ['admin'])) {
            console.warn(`[export] ⚠️ Access denied: role=${validation.member.role}`)
            return Response.json({ error: 'Only admins can export data' }, { status: 403 })
          }

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

          console.log(`[export] ✅ Export complete: ${orgPosts.length} posts`)
          return new Response(csvContent, {
            headers: {
              'Content-Type': 'text/csv',
              'Content-Disposition': `attachment; filename="${filename}"`,
            },
          })
        } catch (error) {
          console.error(`[export] ❌ Export failed:`, error)
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },
    },
  },
})
