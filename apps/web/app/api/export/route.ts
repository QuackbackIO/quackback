import { NextRequest, NextResponse } from 'next/server'
import { validateApiTenantAccess } from '@/lib/tenant'
import { requireRole } from '@/lib/api-handler'
import { getPostService, getBoardService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'
import { isValidTypeId, type BoardId, type WorkspaceId } from '@quackback/ids'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const workspaceIdParam = searchParams.get('workspaceId')
    const boardIdParam = searchParams.get('boardId')

    // Validate organization ID format
    if (!workspaceIdParam || !isValidTypeId(workspaceIdParam, 'workspace')) {
      return NextResponse.json({ error: 'Invalid organization ID' }, { status: 400 })
    }
    const workspaceId = workspaceIdParam as WorkspaceId

    // Validate tenant access
    const validation = await validateApiTenantAccess(workspaceId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Check role - only admin/owner can export
    if (!requireRole(validation.member.role, ['owner', 'admin'])) {
      return NextResponse.json({ error: 'Only admins can export data' }, { status: 403 })
    }

    // Build service context
    const ctx = buildServiceContext(validation)
    const boardService = getBoardService()
    const postService = getPostService()

    // Validate boardId TypeID format
    let boardId: BoardId | undefined
    if (boardIdParam) {
      if (!isValidTypeId(boardIdParam, 'board')) {
        return NextResponse.json({ error: 'Invalid board ID format' }, { status: 400 })
      }
      boardId = boardIdParam as BoardId
      // Verify board belongs to organization
      const boardResult = await boardService.validateBoardBelongsToOrg(
        boardId,
        validation.workspace.id
      )
      if (!boardResult.success) {
        return NextResponse.json({ error: 'Board not found' }, { status: 400 })
      }
    }

    // Get all posts for export
    const postsResult = await postService.listPostsForExport(boardId, ctx)
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
      : `posts-export-${validation.workspace.slug}-${Date.now()}.csv`

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
