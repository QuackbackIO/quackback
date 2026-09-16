/**
 * Admin Overview — types and mapping helpers.
 *
 * Labels and hrefs are derived from real columns:
 *   conversations.waitingSince, conversations.priority, post_statuses.{name,slug,category,isDefault},
 *   changelog_entries.publishedAt, kb_articles.publishedAt, post_activity.type + metadata.toName.
 * Do not invent status names such as "Unreviewed" or "Ready to announce".
 */
import { priorityMeta } from '@/lib/shared/conversation/priority-meta'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import type { ActivityType } from '@/lib/shared/types/activity'
import { getInitials } from '@/lib/shared/utils'

export type OverviewScope = 'team' | 'mine'

export type OverviewAttentionKind = 'support' | 'feedback' | 'publishing'

export type OverviewReasonTone = 'urgent' | 'neutral' | 'info' | 'success'

export type OverviewAttentionItem = {
  id: string
  kind: OverviewAttentionKind
  title: string
  link: OverviewLink
  /** Displayed pill — a real priority label, "Unassigned", "Waiting on reply", or a post status name. */
  reason: string
  reasonTone: OverviewReasonTone
  /** Status or priority hex, when the reason maps to a real colored field. */
  reasonColor?: string | null
  meta: string
  ownerName: string | null
  ownerInitials: string | null
  voteCount?: number
  boardName?: string | null
  createdAt?: string | null
  visitorName?: string | null
  waitingSince?: string | null
}

export type OverviewLink = {
  to: string
  search?: Record<string, string | string[] | undefined>
  params?: Record<string, string>
}

export type OverviewMetric = {
  key: 'waiting' | 'feedback' | 'complete' | 'articles'
  label: string
  count: number
  unit: string
  hint: string
  hintTone: 'urgent' | 'neutral'
  link: OverviewLink
  filter: OverviewAttentionKind | 'articles'
}

type OverviewMetricsInput = {
  scope: OverviewScope
  support?: {
    waitingCount: number
    highPriorityCount: number
    waitingLink: OverviewLink
  }
  feedback?: {
    reviewCount: number
    completeCount: number
    reviewLink: OverviewLink | null
    completeLink: OverviewLink | null
  }
  help?: {
    draftCount: number
    draftLink: OverviewLink
  }
}

/** Labels and units stay short enough for a 2-up phone grid. Skip hints that restate the label. */
export function buildOverviewMetrics(input: OverviewMetricsInput): OverviewMetric[] {
  const metrics: OverviewMetric[] = []
  if (input.support) {
    const high = input.support.highPriorityCount
    metrics.push({
      key: 'waiting',
      label: 'Waiting for reply',
      count: input.support.waitingCount,
      unit: 'open',
      hint: high > 0 ? `${high} high priority` : '',
      hintTone: high > 0 ? 'urgent' : 'neutral',
      link: input.support.waitingLink,
      filter: 'support',
    })
  }
  if (input.feedback?.reviewLink) {
    metrics.push({
      key: 'feedback',
      label: 'Feedback to review',
      count: input.feedback.reviewCount,
      unit: 'open',
      hint: '',
      hintTone: 'neutral',
      link: input.feedback.reviewLink,
      filter: 'feedback',
    })
  }
  if (input.feedback?.completeLink) {
    metrics.push({
      key: 'complete',
      label: 'No changelog',
      count: input.feedback.completeCount,
      unit: 'open',
      hint: '',
      hintTone: 'neutral',
      link: input.feedback.completeLink,
      filter: 'publishing',
    })
  }
  if (input.help) {
    metrics.push({
      key: 'articles',
      label: input.scope === 'mine' ? 'Your drafts' : 'Article drafts',
      count: input.help.draftCount,
      unit: 'drafts',
      hint: '',
      hintTone: 'neutral',
      link: input.help.draftLink,
      filter: 'articles',
    })
  }
  return metrics
}

/** Never 3-up on a phone — 3 skinny columns overflow the metric labels. */
export function overviewMetricGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1'
  if (count === 3) return 'grid-cols-1 sm:grid-cols-3'
  if (count >= 4) return 'grid-cols-2 lg:grid-cols-4'
  return 'grid-cols-2'
}

export type OverviewMomentumItem = {
  postId: string
  title: string
  boardName: string
  statusName: string
  statusColor?: string | null
  voteCount: number
  votesLast7d: number
  link: OverviewLink
}

export type OverviewPublishStatus = 'draft' | 'scheduled' | 'published'

export type OverviewPublishItem = {
  id: string
  product: 'changelog' | 'helpCenter'
  title: string
  link: OverviewLink
  status: OverviewPublishStatus
  meta: string
}

export type OverviewActivityItem = {
  id: string
  actorName: string | null
  actorInitials: string | null
  event: string
  title: string
  link: OverviewLink
  at: string
}

export type OverviewSectionState = {
  enabled: boolean
  error: string | null
}

export type AdminOverviewData = {
  generatedAt: string
  scope: OverviewScope
  metrics: OverviewMetric[]
  attention: OverviewAttentionItem[]
  momentum: OverviewMomentumItem[]
  publishing: {
    changelog: OverviewPublishItem[]
    helpCenter: OverviewPublishItem[]
  }
  activity: OverviewActivityItem[]
  sections: {
    support: OverviewSectionState
    feedback: OverviewSectionState
    changelog: OverviewSectionState
    helpCenter: OverviewSectionState
  }
}

export function ownerInitials(name: string | null | undefined): string | null {
  if (!name?.trim()) return null
  const value = getInitials(name)
  return value === '?' ? null : value
}

/** Compact age for waitingSince / lastMessageAt / generatedAt. */
export function formatCompactAge(fromIso: string, now = Date.now()): string {
  const ms = now - new Date(fromIso).getTime()
  if (!Number.isFinite(ms)) return ''
  const waiting = ms < 0
  const abs = Math.abs(ms)
  const minutes = Math.floor(abs / 60_000)
  if (minutes < 1) return waiting ? 'in <1m' : '<1m'
  if (minutes < 60) return waiting ? `in ${minutes}m` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  if (hours < 24) {
    const body = rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
    return waiting ? `in ${body}` : body
  }
  const days = Math.floor(hours / 24)
  return waiting ? `in ${days}d` : `${days}d`
}

export function conversationTitle(subject: string | null, preview: string | null): string {
  const title = subject?.trim() || preview?.trim()
  return title || 'Conversation'
}

/**
 * Pill for a waiting conversation. Priority is the real enum; Unassigned is
 * assignedAgentPrincipalId IS NULL; otherwise the row is in the queue because
 * waitingSince IS NOT NULL.
 */
export function supportAttentionReason(input: {
  priority: ConversationPriority
  assigned: boolean
}): { reason: string; tone: OverviewReasonTone } {
  if (input.priority === 'urgent' || input.priority === 'high') {
    return { reason: priorityMeta(input.priority).label, tone: 'urgent' }
  }
  if (!input.assigned) return { reason: 'Unassigned', tone: 'neutral' }
  return { reason: 'Waiting on reply', tone: 'neutral' }
}

export function supportAttentionRank(input: {
  priority: ConversationPriority
  assigned: boolean
  waitingSince: string | null
}): number {
  if (input.priority === 'urgent') return 0
  if (input.priority === 'high') return 1
  if (!input.assigned) return 2
  return 3
}

export function sortAttention(items: OverviewAttentionItem[]): OverviewAttentionItem[] {
  const rank: Record<OverviewAttentionKind, number> = {
    support: 0,
    feedback: 1,
    publishing: 2,
  }
  return [...items].sort((a, b) => rank[a.kind] - rank[b.kind])
}

/** Round-robin kinds so one product cannot fill the whole queue. Support still leads. */
export function mixAttention(
  groups: OverviewAttentionItem[][],
  limit: number
): OverviewAttentionItem[] {
  const queues = groups.map((group) => [...group])
  const mixed: OverviewAttentionItem[] = []
  while (mixed.length < limit) {
    let added = false
    for (const queue of queues) {
      const next = queue.shift()
      if (!next) continue
      mixed.push(next)
      added = true
      if (mixed.length >= limit) break
    }
    if (!added) break
  }
  return mixed
}

export type OverviewActivitySource =
  | {
      source: 'post'
      type: ActivityType | string
      actorName: string | null
      toName?: string | null
    }
  | { source: 'changelog'; status: OverviewPublishStatus; actorName: string | null }
  | { source: 'article'; published: boolean; actorName: string | null }
  | { source: 'conversation'; actorName: string | null }

function actorLabel(name: string | null): string {
  return name?.trim() || 'A teammate'
}

/** Event line from a real activity type / publish state — never a canned name. */
export function describeOverviewActivity(source: OverviewActivitySource): string {
  switch (source.source) {
    case 'post': {
      const who = actorLabel(source.actorName)
      if (source.type === 'status.changed' && source.toName) {
        return `${who} moved feedback to ${source.toName}`
      }
      if (source.type === 'post.created') return `${who} created feedback`
      if (source.type === 'owner.assigned') return `${who} assigned feedback`
      return `${who} updated feedback`
    }
    case 'changelog': {
      const who = actorLabel(source.actorName)
      if (source.status === 'scheduled') return `${who} scheduled a changelog`
      if (source.status === 'published') return `${who} published a changelog`
      return `${who} edited a changelog`
    }
    case 'article': {
      const who = actorLabel(source.actorName)
      return source.published ? `${who} published an article` : `${who} edited an article`
    }
    case 'conversation':
      return `${actorLabel(source.actorName)} resolved a conversation`
  }
}

export function publishStatusLabel(status: OverviewPublishStatus): string {
  if (status === 'draft') return 'Draft'
  if (status === 'scheduled') return 'Scheduled'
  return 'Published'
}

export function publishStatusTone(status: OverviewPublishStatus): OverviewReasonTone {
  if (status === 'scheduled') return 'info'
  if (status === 'published') return 'success'
  return 'neutral'
}
