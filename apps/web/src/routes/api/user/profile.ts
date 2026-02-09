import { createFileRoute } from '@tanstack/react-router'
import { db, user, eq } from '@/lib/server/db'
import type { UserId } from '@quackback/ids'
import { getSession } from '@/lib/server/functions/auth'
import { deleteObject } from '@/lib/server/storage/s3'
import { syncPrincipalProfile } from '@/lib/server/domains/principals/principal.service'

export const Route = createFileRoute('/api/user/profile')({
  server: {
    handlers: {
      /**
       * GET /api/user/profile
       * Get current user's profile information.
       */
      GET: async () => {
        console.log(`[api] GET /user/profile`)

        try {
          const session = await getSession()
          if (!session?.user) {
            console.warn(`[api] ⚠️ Unauthorized profile access`)
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }

          const userRecord = await db.query.user.findFirst({
            where: eq(user.id, session.user.id),
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
              imageKey: true,
            },
          })

          if (!userRecord) {
            return Response.json({ error: 'User not found' }, { status: 404 })
          }

          return Response.json({
            ...userRecord,
            hasCustomAvatar: !!userRecord.imageKey,
          })
        } catch (error) {
          console.error(`[api] ❌ Profile fetch failed:`, error)
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },

      /**
       * PATCH /api/user/profile
       * Update current user's profile (name only - avatar uploads use presigned URLs).
       */
      PATCH: async ({ request }) => {
        console.log(`[api] PATCH /user/profile`)

        try {
          const session = await getSession()
          if (!session?.user) {
            console.warn(`[api] ⚠️ Unauthorized profile update`)
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }

          const contentType = request.headers.get('content-type') || ''

          let name: string | undefined

          if (contentType.includes('application/json')) {
            const body = (await request.json()) as { name?: string }
            if (body.name && typeof body.name === 'string') {
              name = body.name.trim()
            }
          }

          if (name !== undefined && name.length < 2) {
            return Response.json({ error: 'Name must be at least 2 characters' }, { status: 400 })
          }

          const updates: { name?: string } = {}

          if (name !== undefined) {
            updates.name = name
          }

          if (Object.keys(updates).length === 0) {
            return Response.json({ error: 'No fields to update' }, { status: 400 })
          }

          const [updated] = await db
            .update(user)
            .set(updates)
            .where(eq(user.id, session.user.id))
            .returning()

          // Sync display name to principal record
          if (updates.name) {
            await syncPrincipalProfile(updated.id as UserId, { displayName: updates.name })
          }

          console.log(`[api] ✅ Profile updated: user=${session.user.id}`)
          return Response.json({
            success: true,
            user: {
              ...updated,
              hasCustomAvatar: !!updated.imageKey,
            },
          })
        } catch (error) {
          console.error(`[api] ❌ Profile update failed:`, error)
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },

      /**
       * DELETE /api/user/profile
       * Remove custom avatar.
       */
      DELETE: async () => {
        console.log(`[api] DELETE /user/profile (avatar)`)

        try {
          const session = await getSession()
          if (!session?.user) {
            console.warn(`[api] ⚠️ Unauthorized avatar delete`)
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }

          // Get current user to check for existing S3 key
          const currentUser = await db.query.user.findFirst({
            where: eq(user.id, session.user.id),
            columns: { imageKey: true },
          })

          // Delete old S3 image if exists
          if (currentUser?.imageKey) {
            try {
              await deleteObject(currentUser.imageKey)
            } catch {
              // Ignore deletion errors - old file may not exist
            }
          }

          const [updated] = await db
            .update(user)
            .set({
              imageKey: null,
            })
            .where(eq(user.id, session.user.id))
            .returning()

          // Sync avatar removal to principal record
          await syncPrincipalProfile(updated.id as UserId, { avatarKey: null })

          console.log(`[api] ✅ Avatar removed: user=${session.user.id}`)
          return Response.json({
            success: true,
            user: {
              ...updated,
              hasCustomAvatar: false,
            },
          })
        } catch (error) {
          console.error(`[api] ❌ Avatar removal failed:`, error)
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },
    },
  },
})
