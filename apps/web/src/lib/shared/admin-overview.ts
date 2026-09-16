/**
 * Admin Overview — types and mapping helpers.
 *
 * Labels and hrefs are derived from real columns:
 *   conversations.waitingSince, conversations.priority, post_statuses.{name,slug,category,isDefault},
 *   changelog_entries.publishedAt, kb_articles.publishedAt.
 * Do not invent status names such as "Unreviewed" or "Ready to announce".
 *
 * The page is workspace-wide. Personal relevance is expressed by ordering
 * (`mine` first within a kind) and the owner avatar, not by a scope filter.
 */
import { priorityMeta } from '@/lib/shared/conversation/priority-meta'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import { getInitials } from '@/lib/shared/utils'

export type AdminEntity = 'conversation' | 'post' | 'changelog' | 'article'

export type OverviewAttentionKind = 'support' | 'feedback' | 'publishing'

export type OverviewReasonTone = 'urgent' | 'neutral' | 'info' | 'success'

export type OverviewAttentionItem = {
  id: string
  kind: OverviewAttentionKind
  entity: AdminEntity
  title: string
  link: OverviewLink
  /** Displayed dot + label — a real priority label, "Unassigned", "Waiting on reply", or a post status name. */
  reason: string
  reasonTone: OverviewReasonTone
  /** Status or priority hex, when the reason maps to a real colored field. */
  reasonColor?: string | null
  /** At most two facts, e.g. "Feature Requests · 9d". */
  meta: string
  ownerName: string | null
  ownerInitials: string | null
  /** Assigned to or owned by the viewer. */
  mine: boolean
}

export type OverviewLink = {
  to: string
  search?: Record<string, string | string[] | undefined>
  params?: Record<string, string>
}

export type OverviewMetric = {
  key: 'waiting' | 'feedback' | 'complete' | 'articles'
  /** Reads as one phrase after the count: "3 waiting for reply". */
  label: string
  count: number
  link: OverviewLink
  filter: OverviewAttentionKind | 'articles'
}

type OverviewMetricsInput = {
  support?: { waitingCount: number; waitingLink: OverviewLink }
  feedback?: {
    reviewCount: number
    completeCount: number
    reviewLink: OverviewLink | null
    completeLink: OverviewLink | null
  }
  help?: { draftCount: number; draftLink: OverviewLink }
}

/** Count + label only. No units, no hints — the list below carries the detail. */
export function buildOverviewMetrics(input: OverviewMetricsInput): OverviewMetric[] {
  const metrics: OverviewMetric[] = []
  if (input.support) {
    metrics.push({
      key: 'waiting',
      label: 'waiting for reply',
      count: input.support.waitingCount,
      link: input.support.waitingLink,
      filter: 'support',
    })
  }
  if (input.feedback?.reviewLink) {
    metrics.push({
      key: 'feedback',
      label: 'to review',
      count: input.feedback.reviewCount,
      link: input.feedback.reviewLink,
      filter: 'feedback',
    })
  }
  if (input.feedback?.completeLink) {
    metrics.push({
      key: 'complete',
      label: 'without changelog',
      count: input.feedback.completeCount,
      link: input.feedback.completeLink,
      filter: 'publishing',
    })
  }
  if (input.help) {
    metrics.push({
      key: 'articles',
      label: input.help.draftCount === 1 ? 'article draft' : 'article drafts',
      count: input.help.draftCount,
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
  entity: 'post'
  title: string
  votesLast7d: number
  link: OverviewLink
}

export type OverviewPublishStatus = 'draft' | 'scheduled'

export type OverviewPublishItem = {
  id: string
  product: 'changelog' | 'helpCenter'
  entity: 'changelog' | 'article'
  title: string
  link: OverviewLink
  status: OverviewPublishStatus
  /** Author name, or the scheduled time for scheduled changelogs. */
  meta: string
}

export type OverviewSectionState = {
  enabled: boolean
  error: string | null
}

export type AdminOverviewData = {
  metrics: OverviewMetric[]
  attention: OverviewAttentionItem[]
  momentum: OverviewMomentumItem[]
  publishing: OverviewPublishItem[]
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

/** Compact age for waitingSince / createdAt / publishedAt. */
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
 * Reason for a waiting conversation. Priority is the real enum; Unassigned is
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

/**
 * Urgency still leads; after that the viewer's own conversations, then the
 * unassigned ones nobody has picked up, then the rest of the team's queue.
 */
export function supportAttentionRank(input: {
  priority: ConversationPriority
  assigned: boolean
  mine: boolean
}): number {
  if (input.priority === 'urgent') return 0
  if (input.priority === 'high') return 1
  if (input.mine) return 2
  if (!input.assigned) return 3
  return 4
}

/** Stable: the viewer's items first, everything else in its existing order. */
export function viewerFirst<T extends { mine: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.mine) - Number(a.mine))
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

export function publishStatusLabel(status: OverviewPublishStatus): string {
  return status === 'scheduled' ? 'Scheduled' : 'Draft'
}
