import { NextRequest, NextResponse } from 'next/server'
import { db, user, eq } from '@quackback/db'

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
    const { userId } = await params

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

    // If user has a blob avatar, serve it
    if (userRecord.imageBlob && userRecord.imageType) {
      return new NextResponse(new Uint8Array(userRecord.imageBlob), {
        headers: {
          'Content-Type': userRecord.imageType,
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        },
      })
    }

    // If user has a URL-based image (from OAuth), redirect to it
    if (userRecord.image) {
      return NextResponse.redirect(userRecord.image)
    }

    // No avatar available
    return NextResponse.json({ error: 'No avatar found' }, { status: 404 })
  } catch (error) {
    console.error('Error fetching avatar:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
