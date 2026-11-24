/**
 * Server functions for the status page subscriber pipeline (Status Product
 * Spec §5, §7 decision 1): self-serve subscribe/unsubscribe and the caller's
 * own status lookup, mirroring `changelog-subscriptions.ts`.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { StatusComponentId } from '@quackback/ids'
import { requireAuth, normalizePrincipalType } from './auth-helpers'
import {
  subscribe,
  unsubscribe,
  getMySubscription,
  getStatusPageSnapshot,
} from '@/lib/server/domains/status'
import { logger } from '@/lib/server/logger'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { resolveStatusPageGate, type StatusPageGateResult } from './status'

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
      throw new ForbiddenError('ANONYMOUS_NOT_ALLOWED', 'Anonymous interaction is not enabled')
    }
    // The page's own gate: someone it would turn away (private portal,
    // unpublished page, audience they are outside of) cannot follow it.
    const gate = await resolveStatusPageGate()
    if (!gate.available) {
      throw new NotFoundError('STATUS_PAGE_NOT_FOUND', 'Status page not found')
    }
    const componentIds =
      data.scope === 'components' ? await followableComponents(gate, data.componentIds ?? []) : []
    await subscribe(auth.principal.id, data.scope, componentIds, 'self_serve')
    return { subscribed: true }
  })

/**
 * The services a component subscription follows: at least one, each one the
 * caller can see on the page (live, in their audience, within the plan).
 * Anything else would store a subscription no incident can ever reach.
 */
async function followableComponents(
  gate: StatusPageGateResult,
  requested: string[]
): Promise<StatusComponentId[]> {
  const chosen = [...new Set(requested)]
  if (chosen.length === 0) {
    throw new ValidationError('INVALID_STATUS_COMPONENTS', 'Choose at least one service to follow')
  }
  const snapshot = await getStatusPageSnapshot(gate.actor, gate.settings)
  const visible = new Set(
    [...snapshot.ungroupedComponents, ...snapshot.groups.flatMap((g) => g.components)].map((c) =>
      String(c.id)
    )
  )
  if (!chosen.every((id) => visible.has(id))) {
    throw new ValidationError('INVALID_STATUS_COMPONENTS', 'Choose services shown on the page')
  }
  return chosen as StatusComponentId[]
}

/** Self-serve unsubscribe from the same button (toggle). */
export const unsubscribeStatusFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth()
  await unsubscribe(auth.principal.id)
  return { subscribed: false }
})
