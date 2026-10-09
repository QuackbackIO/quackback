import type { Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types/settings'
import { listInboxPosts } from '@/lib/server/domains/posts/post.inbox'
import { listArticles } from '@/lib/server/domains/help-center/help-center.article.query'
import { listChangelogs } from '@/lib/server/domains/changelog/changelog.query'
import { listConversationsForAgent } from '@/lib/server/domains/conversation/conversation.query'
import { searchTickets } from '@/lib/server/domains/tickets/ticket-search.service'
import type { AskEntityResult } from '@/lib/shared/assistant/ask-search'

/** Instant entity lookup uses existing access-scoped keyword searches. */
export async function searchAskEntities(
  query: string,
  actor: Actor,
  flags: Partial<FeatureFlags>
): Promise<AskEntityResult[]> {
  const text = query.trim().slice(0, 200)
  if (!text || !actor.principalId || (actor.role !== 'admin' && actor.role !== 'member')) return []
  const searches: Promise<AskEntityResult[]>[] = []
  if (isProductEnabled(flags, 'feedback') && can(actor, PERMISSIONS.POST_VIEW_PRIVATE)) {
    searches.push(
      listInboxPosts({ search: text, limit: 4 }, actor).then((result) =>
        result.items.map((post) => ({
          id: post.id,
          kind: 'post',
          title: post.title,
          href: `/admin/feedback?post=${encodeURIComponent(post.id)}`,
        }))
      )
    )
  }
  if (isProductEnabled(flags, 'helpCenter') && can(actor, PERMISSIONS.HELP_CENTER_MANAGE)) {
    searches.push(
      listArticles(
        { search: text, limit: 4 },
        { audience: 'team', viewer: actor, searchMode: 'keyword' }
      ).then((result) =>
        result.items.map((article) => ({
          id: article.id,
          kind: 'article',
          title: article.title,
          href: `/admin/help-center?article=${encodeURIComponent(article.id)}`,
        }))
      )
    )
  }
  if (
    isProductEnabled(flags, 'changelog') &&
    (can(actor, PERMISSIONS.CHANGELOG_VIEW_DRAFT) || can(actor, PERMISSIONS.CHANGELOG_MANAGE))
  ) {
    searches.push(
      listChangelogs({ search: text, limit: 4 }).then((result) =>
        result.items.map((entry) => ({
          id: entry.id,
          kind: 'changelog',
          title: entry.title,
          href: `/admin/changelog?entry=${encodeURIComponent(entry.id)}`,
        }))
      )
    )
  }
  if (flags.supportInbox && can(actor, PERMISSIONS.CONVERSATION_VIEW)) {
    searches.push(
      listConversationsForAgent({ search: text, limit: 4 }, actor).then((result) =>
        result.conversations.map((conversation) => ({
          id: conversation.id,
          kind: 'conversation',
          title: conversation.subject ?? conversation.visitor.displayName ?? '',
          href: `/admin/inbox?i=${encodeURIComponent(conversation.id)}`,
        }))
      )
    )
  }
  if (flags.supportTickets && can(actor, PERMISSIONS.TICKET_VIEW)) {
    searches.push(
      searchTickets(actor, { query: text, audience: 'agent', limit: 4 }).then((result) =>
        result.map(({ ticket }) => ({
          id: ticket.id,
          kind: 'ticket',
          title: ticket.title,
          href: `/admin/inbox?i=${encodeURIComponent(ticket.id)}`,
        }))
      )
    )
  }
  return (await Promise.all(searches)).flat().slice(0, 12)
}
