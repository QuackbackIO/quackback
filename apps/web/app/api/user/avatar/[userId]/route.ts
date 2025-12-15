import { NextRequest, NextResponse } from 'next/server'
import { db, user, eq } from '@quackback/db'
import { isValidTypeId, type UserId } from '@quackback/ids'

/**
 * GET /api/user/avatar/[userId]
 *
 * Serve user avatar image.
 * Returns the blob image if available, or redirects to the URL image if set.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: userIdParam } = await params

    // Validate TypeID format
    if (!isValidTypeId(userIdParam, 'user')) {
      return NextResponse.json({ error: 'Invalid user ID format' }, { status: 400 })
    }
    const userId = userIdParam as UserId

    const userRecord = await db.query.user.findFirst({
      where: eq(user.id, userId),
      columns: {
        imageBlob: true,
        imageType: true,
        image: true,
      },
    })

    if (!userRecord) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // If user has a blob avatar, serve it (this takes priority)
    if (userRecord.imageBlob && userRecord.imageType) {
      return new NextResponse(new Uint8Array(userRecord.imageBlob), {
        headers: {
          'Content-Type': userRecord.imageType,
          // Short cache with must-revalidate to allow quick updates
          // Browser will revalidate after 60 seconds
          'Cache-Control': 'public, max-age=60, must-revalidate',
        },
      })
    }

    // If user has an external URL-based image (from OAuth), redirect to it
    // Skip redirect if it's a local avatar endpoint URL (would cause infinite loop)
    if (userRecord.image && !userRecord.image.startsWith('/api/user/avatar/')) {
      return NextResponse.redirect(userRecord.image)
    }

    // No avatar available
    return NextResponse.json({ error: 'No avatar found' }, { status: 404 })
  } catch (error) {
    console.error('Error fetching avatar:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
