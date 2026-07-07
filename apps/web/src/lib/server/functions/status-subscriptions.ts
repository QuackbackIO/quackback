/**
 * Server functions for the status page subscriber pipeline (Status Product
 * Spec §5, §7 decision 1): self-serve subscribe/unsubscribe and the caller's
 * own status lookup, mirroring `changelog-subscriptions.ts`.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { StatusComponentId } from '@quackback/ids'
import { requireAuth, normalizePrincipalType } from './auth-helpers'
import { subscribe, unsubscribe, getMySubscription } from '@/lib/server/domains/status'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'status-subscriptions' })

/** The signed-in caller's own subscription status, for the Subscribe button.
 *  Mirrors `getMyChangelogSubscriptionFn`: a bare `requireAuth()` — a
 *  better-auth anonymous session still resolves to a principal here, and
 *  simply comes back `subscribed: false` since it never has a row. */
export const getMyStatusSubscriptionFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth()
  return getMySubscription(auth.principal.id)
})

const subscribeStatusSchema = z.object({
  scope: z.enum(['page', 'components']),
  componentIds: z.array(z.string()).optional(),
})

/**
 * Self-serve Subscribe action on the public status page. Requires a REAL
 * signed-in principal, not just any `requireAuth()`-passing session: a
 * better-auth anonymous session satisfies `requireAuth()` but must not be
 * able to create a durable subscription row, so it's rejected here with the
 * same `'Anonymous interaction is not enabled'` message the anonymous-vote/
 * comment/post gates already throw (public-posts.ts, comments.ts) — the
 * portal's mutation `onError` string-matches this message to open the auth
 * dialog instead of showing a generic error toast.
 */
export const subscribeStatusFn = createServerFn({ method: 'POST' })
  .validator(subscribeStatusSchema)
  .handler(async ({ data }) => {
    log.debug({ scope: data.scope }, 'status subscribe')
    const auth = await requireAuth()
    if (normalizePrincipalType(auth.principal.type) === 'anonymous') {
      throw new Error('Anonymous interaction is not enabled')
    }
    await subscribe(
      auth.principal.id,
      data.scope,
      (data.componentIds ?? []) as StatusComponentId[],
      'self_serve'
    )
    return { subscribed: true }
  })

/** Self-serve unsubscribe from the same button (toggle). */
export const unsubscribeStatusFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth()
  await unsubscribe(auth.principal.id)
  return { subscribed: false }
})
