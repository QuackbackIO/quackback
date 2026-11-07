/**
 * Brand matching in Ask AI, streamed: each stage's step as it starts, then
 * the result (the changes saved to the draft, the reply, its questions,
 * notes and follow-ups), as TanStack AI stream events over server-sent
 * events. Needs the branding permission.
 */
import { createFileRoute } from '@tanstack/react-router'
import { EventType, toServerSentEventsResponse, type StreamChunk } from '@tanstack/ai'
import { requireAuth } from '@/lib/server/functions/auth-helpers'
import { isAuthDenialError } from '@/lib/server/functions/auth-errors'
import { errorResponse, forbiddenResponse } from '@/lib/server/domains/api/responses'
import { logger } from '@/lib/server/logger'
import { withSseKeepalive } from '@/lib/server/domains/assistant/agui'
import { PERMISSIONS } from '@/lib/shared/permissions'

const log = logger.child({ route: 'brand-match' })

/** The custom event that carries the result. */
export const BRAND_MATCH_RESULT = 'brand-match-result'

/**
 * The check after a match (the verified critic loop) is a Labs switch, off
 * by default: while it is off, the match says it cannot be checked, so the
 * builder neither runs it nor mentions it.
 */
async function checkWhenOn<R>(result: R): Promise<R> {
  const target = (result as { target?: { checkable?: boolean } | null }).target
  if (!target?.checkable) return result
  const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
  if (await isFeatureEnabled('brandCheckLoop')) return result
  return { ...result, target: { ...target, checkable: false } }
}

export async function handleBrandMatch({ request }: { request: Request }): Promise<Response> {
  let auth
  try {
    auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  } catch (error) {
    if (isAuthDenialError(error)) return forbiddenResponse('Branding access required')
    throw error
  }
  const [{ brandMatchRequest, runBrandMatchRequest }, { BRAND_STEPS }] = await Promise.all([
    import('@/lib/server/domains/design/ai/brand-match-request'),
    import('@/lib/server/domains/design/ai/brand-match'),
  ])
  const parsed = brandMatchRequest.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return errorResponse('VALIDATION_ERROR', 'The screenshots could not be read.', 400)

  // Steps queue up as the match reaches them; the stream drains them in order.
  const queue: StreamChunk[] = []
  let wake: (() => void) | null = null
  let finished = false
  const push = (chunk: StreamChunk) => {
    queue.push(chunk)
    wake?.()
  }
  // The request's signal tells the match when the builder has gone, so it
  // saves nothing the builder will not hear about.
  const run = runBrandMatchRequest(
    parsed.data,
    auth,
    (step) =>
      push({
        type: EventType.STEP_STARTED,
        stepName: BRAND_STEPS[step],
        timestamp: Date.now(),
      } as StreamChunk),
    request.signal
  )
    .then(checkWhenOn)
    .then((result) =>
      push({
        type: EventType.CUSTOM,
        name: BRAND_MATCH_RESULT,
        value: result,
        timestamp: Date.now(),
      } as StreamChunk)
    )
    .catch((err: unknown) => {
      log.error({ err }, 'brand match failed')
      push({
        type: EventType.CUSTOM,
        name: BRAND_MATCH_RESULT,
        value: {
          ok: false,
          code: 'AI_FAILED',
          message: 'Quackback AI could not match your brand. Try again.',
        },
        timestamp: Date.now(),
      } as StreamChunk)
    })
    .finally(() => {
      finished = true
      wake?.()
    })

  async function* events(): AsyncGenerator<StreamChunk> {
    for (;;) {
      while (queue.length) yield queue.shift()!
      if (finished) break
      await new Promise<void>((done) => {
        wake = done
      })
      wake = null
    }
    await run
  }
  // A stage can be silent for longer than the server keeps an idle
  // connection (Bun closes one after 10 s; the read has taken 17 s): comments
  // keep bytes flowing between steps.
  return withSseKeepalive(toServerSentEventsResponse(events()))
}

export const Route = createFileRoute('/api/admin/design/brand-match')({
  server: { handlers: { POST: handleBrandMatch } },
})
