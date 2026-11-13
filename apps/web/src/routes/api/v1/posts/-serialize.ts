import type { PostSubscriberInfo } from '@/lib/server/domains/posts/post.subscribers'

/** Someone subscribed to a post, as the API returns them. */
export function serializePostSubscriber(s: PostSubscriberInfo) {
  return {
    principalId: s.principalId,
    displayName: s.displayName,
    email: s.email,
    avatarUrl: s.avatarUrl,
    isTeamMember: s.isTeamMember,
    reason: s.reason,
    level: s.level,
    canView: s.canView,
    createdAt: s.createdAt.toISOString(),
  }
}
