import { NextRequest, NextResponse } from 'next/server'
import { db, user, eq } from '@quackback/db'
import { getSession } from '@/lib/auth/server'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

/**
 * GET /api/user/profile
 *
 * Get current user's profile information.
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userRecord = await db.query.user.findFirst({
      where: eq(user.id, session.user.id),
      columns: {
        id: true,
        name: true,
        email: true,
        image: true,
        imageBlob: false, // Don't send blob in JSON response
        imageType: true,
      },
    })

    if (!userRecord) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      ...userRecord,
      hasCustomAvatar: !!userRecord.imageType,
    })
  } catch (error) {
    console.error('Error fetching user profile:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/user/profile
 *
 * Update current user's profile.
 * Accepts multipart/form-data with:
 * - name (string, optional): Update display name
 * - avatar (file, optional): Profile image (max 5MB)
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const contentType = request.headers.get('content-type') || ''

    let name: string | undefined
    let avatarBuffer: Buffer | undefined
    let avatarType: string | undefined

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const nameField = formData.get('name')
      const avatarField = formData.get('avatar')

      if (nameField && typeof nameField === 'string') {
        name = nameField.trim()
      }

      if (avatarField && avatarField instanceof File && avatarField.size > 0) {
        // Validate file type
        if (!ALLOWED_TYPES.includes(avatarField.type)) {
          return NextResponse.json(
            { error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP' },
            { status: 400 }
          )
        }

        // Validate file size
        if (avatarField.size > MAX_FILE_SIZE) {
          return NextResponse.json(
            { error: 'File too large. Maximum size is 5MB' },
            { status: 400 }
          )
        }

        const arrayBuffer = await avatarField.arrayBuffer()
        avatarBuffer = Buffer.from(arrayBuffer)
        avatarType = avatarField.type
      }
    } else if (contentType.includes('application/json')) {
      const body = await request.json()
      if (body.name && typeof body.name === 'string') {
        name = body.name.trim()
      }
    }

    // Validate name if provided
    if (name !== undefined && name.length < 2) {
      return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 })
    }

    // Build update object
    const updates: {
      name?: string
      image?: string
      imageBlob?: Buffer
      imageType?: string
    } = {}

    if (name !== undefined) {
      updates.name = name
    }

    if (avatarBuffer && avatarType) {
      updates.imageBlob = avatarBuffer
      updates.imageType = avatarType
      // Set image field to avatar endpoint URL so useSession returns correct avatar
      updates.image = `/api/user/avatar/${session.user.id}`
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Update the user
    const [updated] = await db
      .update(user)
      .set(updates)
      .where(eq(user.id, session.user.id))
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        imageType: user.imageType,
      })

    return NextResponse.json({
      success: true,
      user: {
        ...updated,
        hasCustomAvatar: !!updated.imageType,
      },
    })
  } catch (error) {
    console.error('Error updating user profile:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/user/profile
 *
 * Remove custom avatar (set imageBlob and imageType to null).
 */
export async function DELETE() {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [updated] = await db
      .update(user)
      .set({
        image: null, // Clear the avatar URL
        imageBlob: null,
        imageType: null,
      })
      .where(eq(user.id, session.user.id))
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        imageType: user.imageType,
      })

    return NextResponse.json({
      success: true,
      user: {
        ...updated,
        hasCustomAvatar: false,
      },
    })
  } catch (error) {
    console.error('Error removing avatar:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
