import { NextRequest, NextResponse } from 'next/server'
import { validateApiTenantAccess } from '@/lib/tenant'
import { requireRole } from '@/lib/api-handler'
import { listPostsForExport } from '@/lib/posts'
import { getBoardById } from '@/lib/boards'
import { isValidTypeId, type BoardId } from '@quackback/ids'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const boardIdParam = searchParams.get('boardId')

    // Validate tenant access
    const validation = await validateApiTenantAccess()
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Check role - only admin/owner can export
    if (!requireRole(validation.member.role, ['owner', 'admin'])) {
      return NextResponse.json({ error: 'Only admins can export data' }, { status: 403 })
    }

    // Validate boardId TypeID format
    let boardId: BoardId | undefined
    if (boardIdParam) {
      if (!isValidTypeId(boardIdParam, 'board')) {
        return NextResponse.json({ error: 'Invalid board ID format' }, { status: 400 })
      }
      boardId = boardIdParam as BoardId
      // Verify board exists
      const boardResult = await getBoardById(boardId)
      if (!boardResult.success) {
        return NextResponse.json({ error: 'Board not found' }, { status: 400 })
      }
    }

    // Get all posts for export
    const postsResult = await listPostsForExport(boardId)
    if (!postsResult.success) {
      return NextResponse.json({ error: postsResult.error.message }, { status: 500 })
    }

    const orgPosts = postsResult.value

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

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Error exporting posts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Escape a value for CSV format, preventing CSV injection attacks
 */
function escapeCSV(value: string): string {
  if (!value) return '""'

  // Prevent CSV injection by prefixing formula characters with single quote
  // These characters can trigger formula execution in Excel/Sheets
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
