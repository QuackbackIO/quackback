import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { consumeTestCustomerToken } from '@/lib/server/test-customer'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'widget-test-session' })

const bodySchema = z.object({ token: z.string().min(1).max(100) })

/**
 * Trades a teammate's one-time test token for a widget Bearer. The response
 * body is the only carrier: no cookie is set, so the teammate's own session in
 * this browser is untouched.
 */
export async function handleWidgetTestSession(request: Request): Promise<Response> {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    const result = parsed.success ? await consumeTestCustomerToken(parsed.data.token) : null
    if (!result) {
      return Response.json(
        { error: { code: 'INVALID_TOKEN', message: 'Test link expired or already used' } },
        { status: 401, headers: noStoreHeaders() }
      )
    }
    return Response.json(
      { data: { sessionToken: result.bearerToken, testSession: true } },
      { headers: noStoreHeaders() }
    )
  } catch (error) {
    log.error({ err: error }, 'widget test session exchange failed')
    return Response.json(
      { error: { code: 'SERVER_ERROR', message: 'Failed to start test session' } },
      { status: 500, headers: noStoreHeaders() }
    )
  }
}

export const Route = createFileRoute('/api/widget/test-session')({
  server: {
    handlers: {
      POST: ({ request }) => handleWidgetTestSession(request),
    },
  },
})

function noStoreHeaders(): HeadersInit {
  return { 'Cache-Control': 'no-store' }
}
