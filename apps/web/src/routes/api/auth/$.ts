import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      /**
       * GET /api/auth/*
       * Better-auth catch-all route handler
       */
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const path = url.pathname.replace('/api/auth', '')
        console.log(`[auth] GET ${path}`)

        // Debug: Log magic link verification requests
        if (path.includes('magic-link/verify')) {
          const token = url.searchParams.get('token')
          console.log(`[auth] Magic link verification request:`)
          console.log(`[auth]   host: ${url.host}`)
          console.log(`[auth]   token length: ${token?.length}`)
          console.log(`[auth]   callbackURL: ${url.searchParams.get('callbackURL')}`)

          // Check if verification record exists before Better Auth processes
          try {
            const { db, verification, eq } = await import('@/lib/server/db')
            const records = await db.query.verification.findMany({
              orderBy: (v, { desc }) => [desc(v.createdAt)],
              limit: 5,
            })
            console.log(`[auth]   Recent verification records in DB: ${records.length}`)
            for (const r of records) {
              console.log(
                `[auth]     - id=${r.id}, identifier=${r.identifier}, value_len=${r.value?.length}`
              )
            }
            // Try to find by token value
            if (token) {
              const byToken = await db.query.verification.findFirst({
                where: eq(verification.value, token),
              })
              console.log(`[auth]   Token found in DB: ${!!byToken}`)
            }
          } catch (e) {
            console.error(`[auth]   Debug query failed:`, e)
          }
        }

        // Dynamic import to prevent client bundling of auth config
        const { auth } = await import('@/lib/server/auth/index')
        return await auth.handler(request)
      },

      /**
       * POST /api/auth/*
       * Better-auth catch-all route handler
       */
      POST: async ({ request }) => {
        const url = new URL(request.url)
        console.log(`[auth] POST ${url.pathname.replace('/api/auth', '')}`)

        // Dynamic import to prevent client bundling of auth config
        const { auth } = await import('@/lib/server/auth/index')
        return await auth.handler(request)
      },
    },
  },
})
