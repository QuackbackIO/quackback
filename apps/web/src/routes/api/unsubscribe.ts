import { createFileRoute } from '@tanstack/react-router'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'unsubscribe-one-click' })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One-click unsubscribe (RFC 8058). Every email carrying an unsubscribe token
 * names this URL in `List-Unsubscribe` with `List-Unsubscribe-Post:
 * List-Unsubscribe=One-Click`, so the mail client's own unsubscribe button
 * works without opening the page. POST only: link scanners issue GETs, and
 * the /unsubscribe page a GET reaches only asks the person to confirm.
 */
export const Route = createFileRoute('/api/unsubscribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = new URL(request.url).searchParams.get('token')
        if (!token || !UUID.test(token)) {
          return Response.json({ error: 'invalid_token' }, { status: 400 })
        }
        try {
          const { processUnsubscribeToken } =
            await import('@/lib/server/domains/subscriptions/subscription.service')
          const result = await processUnsubscribeToken(token)
          if (!result) return Response.json({ error: 'expired' }, { status: 410 })
          log.info({ action: result.action }, 'one-click unsubscribe processed')
          return Response.json({ ok: true })
        } catch (error) {
          log.error({ err: error }, 'one-click unsubscribe failed')
          return Response.json({ error: 'failed' }, { status: 500 })
        }
      },
    },
  },
})
