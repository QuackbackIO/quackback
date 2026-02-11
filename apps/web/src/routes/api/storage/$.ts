import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/storage/$')({
  server: {
    handlers: {
      /**
       * GET /api/storage/*
       * Redirect to a presigned S3 URL for the given storage key.
       *
       * This enables serving files from private S3 buckets (e.g., Railway Buckets)
       * without exposing credentials. The browser follows the 302 redirect and loads
       * the file directly from S3 — no bytes are proxied through the server.
       *
       * Set S3_PUBLIC_URL to your app's base URL + /api/storage to use this route:
       *   S3_PUBLIC_URL="https://your-app.railway.app/api/storage"
       */
      GET: async ({ request }) => {
        const { isS3Configured, generatePresignedGetUrl } = await import('@/lib/server/storage/s3')

        if (!isS3Configured()) {
          return Response.json({ error: 'Storage not configured' }, { status: 503 })
        }

        const url = new URL(request.url)
        const prefix = '/api/storage/'
        const key = decodeURIComponent(url.pathname.slice(prefix.length))

        if (!key || key.includes('..')) {
          return Response.json({ error: 'Invalid storage key' }, { status: 400 })
        }

        try {
          const presignedUrl = await generatePresignedGetUrl(key)

          return new Response(null, {
            status: 302,
            headers: {
              Location: presignedUrl,
              'Cache-Control': 'public, max-age=86400',
            },
          })
        } catch (error) {
          console.error('Error generating presigned GET URL:', error)
          return Response.json({ error: 'Failed to resolve storage URL' }, { status: 500 })
        }
      },
    },
  },
})
