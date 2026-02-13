import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/storage/$')({
  server: {
    handlers: {
      /**
       * GET /api/storage/*
       * Serve files from S3 storage.
       *
       * When S3_PROXY is enabled, streams file bytes through the server — useful when
       * the browser can't reach the S3 endpoint directly (e.g., ngrok, mixed content).
       *
       * Otherwise, redirects to a presigned S3 URL (302) so the browser fetches
       * directly from S3 — no bytes are proxied through the server.
       */
      GET: async ({ request }) => {
        const { isS3Configured, generatePresignedGetUrl, getS3Object } =
          await import('@/lib/server/storage/s3')
        const { config } = await import('@/lib/server/config')

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
          if (config.s3Proxy) {
            const { body, contentType } = await getS3Object(key)

            return new Response(body, {
              status: 200,
              headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400',
              },
            })
          }

          const presignedUrl = await generatePresignedGetUrl(key)

          return new Response(null, {
            status: 302,
            headers: {
              Location: presignedUrl,
              'Cache-Control': 'public, max-age=86400',
            },
          })
        } catch (error) {
          console.error('Error serving storage object:', error)
          return Response.json({ error: 'Failed to resolve storage URL' }, { status: 500 })
        }
      },
    },
  },
})
