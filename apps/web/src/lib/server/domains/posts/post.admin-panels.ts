/**
 * The panels beside a post in the admin post modal: the voter stack, pending
 * merge suggestions, linked external issues, the owner picker's roster, the
 * author's customer context, the post's subscribers and the teammate's own
 * follow bell.
 *
 * Each panel has its own query, refreshed on its own by the mutations that
 * change it. On open they are all empty, and filling them one request each
 * costs a round trip, an auth resolution and a render per panel, so the post
 * detail request loads the panels its caller asks for with the post. Every
 * panel comes back in the shape its own server function returns, because the
 * client seeds that function's query with it.
 */
import type { PostId, PrincipalId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { toIsoString } from '@/lib/shared/utils'
import { logger } from '@/lib/server/logger'
import { getPendingSuggestionsForPost } from '@/lib/server/domains/merge-suggestions/merge-suggestion.service'
import { listTeamMembers } from '@/lib/server/domains/principals/principal.service'
import { toOwnerRef } from '@/lib/server/functions/post-owner-context'
import type { EnrichmentCard } from '@/lib/server/integrations/types'
import { getSubscriptionStatus } from '@/lib/server/domains/subscriptions/subscription.service'
import { getPostVoters } from './post.voters'
import { getPostExternalLinks } from './post.cascade-delete'
import { readPostSubscribers } from './post.subscribers'

const log = logger.child({ component: 'merge-suggestions' })

export const ADMIN_POST_PANELS = [
  'voters',
  'mergeSuggestions',
  'externalLinks',
  'ownerCandidates',
  'customerContext',
  'subscribers',
  'subscription',
] as const

export type AdminPostPanel = (typeof ADMIN_POST_PANELS)[number]

/** Voters as `fetchPostVotersFn` returns them. */
export async function loadPostVotersPanel(postId: PostId) {
  const voters = await getPostVoters(postId)
  return voters.map((v) => ({
    ...v,
    createdAt: toIsoString(v.createdAt as Date | string),
  }))
}

/** Subscribers as `listPostSubscribersFn` returns them. */
export async function loadPostSubscribersPanel(postId: PostId) {
  const subscribers = await readPostSubscribers(postId)
  return subscribers.map((s) => ({ ...s, createdAt: toIsoString(s.createdAt) }))
}

/** Pending merge suggestions as `getMergeSuggestionsForPostFn` returns them. */
export async function loadMergeSuggestionsPanel(postId: PostId) {
  try {
    const suggestions = await getPendingSuggestionsForPost(postId)
    return suggestions.map((s) => ({
      ...s,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    }))
  } catch (error) {
    log.error({ err: error, post_id: postId }, 'get merge suggestions for post failed')
    return []
  }
}

/**
 * The author's customer context, only where it is known without a lookup:
 * no cards when no connected integration could answer one, or when the caller
 * lacks integration.view and `fetchCustomerContextFn` would refuse it.
 * Otherwise undefined, and the panel runs its lookup on its own request so
 * calls out to third parties never hold up the post.
 */
async function loadCustomerContextPanel(
  permissions: readonly PermissionKey[]
): Promise<EnrichmentCard[] | undefined> {
  if (!permissions.includes(PERMISSIONS.INTEGRATION_VIEW)) return []
  const { hasCustomerContextProvider } = await import('@/lib/server/integrations/context')
  return (await hasCustomerContextProvider()) ? undefined : []
}

type Panels = {
  voters?: Awaited<ReturnType<typeof loadPostVotersPanel>>
  mergeSuggestions?: Awaited<ReturnType<typeof loadMergeSuggestionsPanel>>
  externalLinks?: Awaited<ReturnType<typeof getPostExternalLinks>>
  ownerCandidates?: ReturnType<typeof toOwnerRef>[]
  customerContext?: EnrichmentCard[]
  subscribers?: Awaited<ReturnType<typeof loadPostSubscribersPanel>>
  subscription?: Awaited<ReturnType<typeof getSubscriptionStatus>>
}

/**
 * Load the requested panels for a post the caller may already view privately.
 * The owner roster also needs post.set_owner, like `listOwnerCandidatesFn`;
 * without it that panel is left out and the client never shows the picker.
 * The follow bell is the caller's own status, read for `viewerId`; a
 * subscriber list that fails is left for its own request.
 */
export async function loadAdminPostPanels(
  postId: PostId,
  requested: readonly AdminPostPanel[],
  permissions: readonly PermissionKey[],
  viewerId?: PrincipalId
): Promise<Panels> {
  const wanted = new Set(requested)
  if (!permissions.includes(PERMISSIONS.POST_SET_OWNER)) wanted.delete('ownerCandidates')

  const [
    voters,
    mergeSuggestions,
    externalLinks,
    ownerCandidates,
    customerContext,
    subscribers,
    subscription,
  ] = await Promise.all([
    wanted.has('voters') ? loadPostVotersPanel(postId) : undefined,
    wanted.has('mergeSuggestions') ? loadMergeSuggestionsPanel(postId) : undefined,
    wanted.has('externalLinks') ? getPostExternalLinks(postId) : undefined,
    wanted.has('ownerCandidates')
      ? listTeamMembers().then((members) => members.map(toOwnerRef))
      : undefined,
    wanted.has('customerContext') ? loadCustomerContextPanel(permissions) : undefined,
    wanted.has('subscribers') ? loadPostSubscribersPanel(postId).catch(() => undefined) : undefined,
    viewerId && wanted.has('subscription') ? getSubscriptionStatus(viewerId, postId) : undefined,
  ])

  const panels: Panels = {}
  if (voters) panels.voters = voters
  if (mergeSuggestions) panels.mergeSuggestions = mergeSuggestions
  if (externalLinks) panels.externalLinks = externalLinks
  if (ownerCandidates) panels.ownerCandidates = ownerCandidates
  if (customerContext) panels.customerContext = customerContext
  if (subscribers) panels.subscribers = subscribers
  if (subscription) panels.subscription = subscription
  return panels
}
