import { createFileRoute } from '@tanstack/react-router'
import { db, user, eq } from '@/lib/db'
import { getSession } from '@/lib/auth/server'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export const Route = createFileRoute('/api/user/profile')({
  server: {
    handlers: {
      /**
       * GET /api/user/profile
       * Get current user's profile information.
       */
      GET: async () => {
        try {
          const session = await getSession()
          if (!session?.user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
            return Response.json({ error: 'User not found' }, { status: 404 })
          }

          return Response.json({
            ...userRecord,
            hasCustomAvatar: !!userRecord.imageType,
          })
        } catch (error) {
          console.error('Error fetching user profile:', error)
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },

      /**
       * PATCH /api/user/profile
       * Update current user's profile.
       */
      PATCH: async ({ request }) => {
        try {
          const session = await getSession()
          if (!session?.user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
              if (!ALLOWED_TYPES.includes(avatarField.type)) {
                return Response.json(
                  { error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP' },
                  { status: 400 }
                )
              }

              if (avatarField.size > MAX_FILE_SIZE) {
                return Response.json(
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

          if (name !== undefined && name.length < 2) {
            return Response.json({ error: 'Name must be at least 2 characters' }, { status: 400 })
          }

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
          }

          if (Object.keys(updates).length === 0) {
            return Response.json({ error: 'No fields to update' }, { status: 400 })
          }

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

          return Response.json({
            success: true,
            user: {
              ...updated,
              hasCustomAvatar: !!updated.imageType,
            },
          })
        } catch (error) {
          console.error('Error updating user profile:', error)
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },

      /**
       * DELETE /api/user/profile
       * Remove custom avatar.
       */
      DELETE: async () => {
        try {
          const session = await getSession()
          if (!session?.user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }

          const [updated] = await db
            .update(user)
            .set({
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

          return Response.json({
            success: true,
            user: {
              ...updated,
              hasCustomAvatar: false,
            },
          })
        } catch (error) {
          console.error('Error removing avatar:', error)
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },
    },
  },
})
