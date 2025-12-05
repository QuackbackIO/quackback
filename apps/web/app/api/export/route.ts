import { NextRequest, NextResponse } from 'next/server'
import { validateApiTenantAccess } from '@/lib/tenant'
import { db, posts, boards, eq, and } from '@quackback/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')
    const boardId = searchParams.get('boardId')

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Check role - only admin/owner can export
    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Only admins can export data' }, { status: 403 })
    }

    if (boardId) {
      // Verify board belongs to organization
      const board = await db.query.boards.findFirst({
        where: and(eq(boards.id, boardId), eq(boards.organizationId, validation.organization.id)),
      })
      if (!board) {
        return NextResponse.json({ error: 'Board not found' }, { status: 400 })
      }
    }

    // Get all posts with their tags and status
    const allPosts = await db.query.posts.findMany({
      where: boardId ? eq(posts.boardId, boardId) : undefined,
      with: {
        board: true,
        postStatus: true,
        tags: {
          with: {
            tag: true,
          },
        },
      },
      orderBy: (posts, { desc }) => [desc(posts.createdAt)],
    })

    // Filter to only posts from this organization (via board)
    const orgPosts = allPosts.filter(
      (post) => post.board?.organizationId === validation.organization.id
    )

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
      const tagNames = post.tags.map((pt) => pt.tag.name).join(',')
      const statusSlug = post.postStatus?.slug || post.status || ''

      return [
        escapeCSV(post.title),
        escapeCSV(post.content),
        escapeCSV(statusSlug),
        escapeCSV(tagNames),
        escapeCSV(post.board?.slug || ''),
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
      : `posts-export-${validation.organization.slug}-${Date.now()}.csv`

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
