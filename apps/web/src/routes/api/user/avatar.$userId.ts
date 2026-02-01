import { createFileRoute } from '@tanstack/react-router'
import { isValidTypeId, type UserId } from '@quackback/ids'

export const Route = createFileRoute('/api/user/avatar/$userId')({
  server: {
    handlers: {
      /**
       * GET /api/user/avatar/[userId]
       * Serve user avatar image.
       */
      GET: async ({ params }) => {
        const { db, user, eq } = await import('@/lib/server/db')

        try {
          const userIdParam = params.userId

          // Validate TypeID format
          if (!isValidTypeId(userIdParam, 'user')) {
            return Response.json({ error: 'Invalid user ID format' }, { status: 400 })
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
            return Response.json({ error: 'User not found' }, { status: 404 })
          }

          // If user has a blob avatar, serve it (this takes priority)
          if (userRecord.imageBlob && userRecord.imageType) {
            return new Response(new Uint8Array(userRecord.imageBlob), {
              headers: {
                'Content-Type': userRecord.imageType,
                // Short cache with must-revalidate to allow quick updates
                'Cache-Control': 'public, max-age=60, must-revalidate',
              },
            })
          }

          // If user has an external URL-based image (from OAuth), redirect to it
          if (userRecord.image && !userRecord.image.startsWith('/api/user/avatar/')) {
            return Response.redirect(userRecord.image)
          }

          // No avatar available
          return Response.json({ error: 'No avatar found' }, { status: 404 })
        } catch (error) {
          console.error('Error fetching avatar:', error)
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },
    },
  },
})
