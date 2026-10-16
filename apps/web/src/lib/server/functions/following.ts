/**
 * The portal's Following page: the posts the signed-in person follows and the
 * support tickets they watch (following.service in subscriptions, and
 * listWatchedCustomerTickets in the tickets domain).
 * Changing a follow goes through the existing per-item fns: the post bell's
 * (functions/subscriptions.ts) and the ticket watch toggle's
 * (functions/tickets.ts), which gate each change on its own.
 */

import { createServerFn } from '@tanstack/react-start'
import { requireAuth, policyActorFromAuth } from './auth-helpers'

export const getMyFollowingFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth()
  // Same portal gate as the post bell: a private portal's titles stay behind it.
  const { resolvePortalAccessForRequest } = await import('./portal-access')
  if (!(await resolvePortalAccessForRequest()).granted) {
    throw new Error('Portal access required')
  }
  const actor = await policyActorFromAuth(auth)
  const { listFollowedPosts } = await import('@/lib/server/domains/subscriptions/following.service')
  const { listWatchedCustomerTickets } =
    await import('@/lib/server/domains/tickets/customer-ticket-sharing.service')
  const { isSupportTicketsEnabled } = await import('@/lib/server/domains/settings/settings.support')
  const [posts, ticketsEnabled] = await Promise.all([
    listFollowedPosts(actor),
    isSupportTicketsEnabled(),
  ])
  return {
    posts: posts.map((p) => ({ ...p, followedAt: p.followedAt.toISOString() })),
    // Null when tickets are off, so the page leaves the section out entirely.
    tickets: ticketsEnabled ? await listWatchedCustomerTickets(auth.principal.id) : null,
  }
})
