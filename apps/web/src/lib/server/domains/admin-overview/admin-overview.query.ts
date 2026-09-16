/* oxlint-disable max-lines -- one aggregation over support, feedback, changelog, and help center */
/**
 * Admin Overview aggregation. Each section is gated on the real product flag
 * and permission, then reads the same columns the product lists already use.
 * Everything is workspace-wide; the viewer only affects ordering via `mine`.
 */
import type { PrincipalId, PostId } from '@quackback/ids'
import {
  db,
  eq,
  and,
  or,
  ne,
  gt,
  gte,
  desc,
  asc,
  count,
  sql,
  isNull,
  isNotNull,
  inArray,
  notExists,
  conversations,
  posts,
  postStatuses,
  postVotes,
  boards,
  principal,
  changelogEntries,
  changelogEntryPosts,
  helpCenterArticles,
} from '@/lib/server/db'
import { can } from '@/lib/server/policy/authorize'
import { conversationFilter } from '@/lib/server/policy/conversations'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types/settings'
import { computeStatus } from '@/lib/server/domains/changelog/changelog.service'
import { priorityMeta } from '@/lib/shared/conversation/priority-meta'
import { logger } from '@/lib/server/logger'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'
import {
  buildOverviewMetrics,
  conversationTitle,
  formatCompactAge,
  ownerInitials,
  mixAttention,
  supportAttentionRank,
  supportAttentionReason,
  viewerFirst,
  type AdminOverviewData,
  type OverviewAttentionItem,
  type OverviewMomentumItem,
  type OverviewLink,
  type OverviewPublishItem,
  type OverviewSectionState,
} from '@/lib/shared/admin-overview'
import type { ConversationPriority } from '@/lib/shared/conversation/types'

const log = logger.child({ component: 'admin-overview' })

const ATTENTION_LIMIT = 8
const MOMENTUM_LIMIT = 3
/** Per product; changelog and help center together stay at four rows or fewer. */
const PUBLISH_LIMIT = 2
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export async function getAdminOverview(input: {
  actor: Actor
  flags: Partial<FeatureFlags> | undefined
}): Promise<AdminOverviewData> {
  const { actor, flags } = input
  const viewerId = actor.principalId
  const now = new Date()

  const supportOn =
    isProductEnabled(flags, 'support') &&
    (can(actor, PERMISSIONS.CONVERSATION_VIEW) || can(actor, PERMISSIONS.CONVERSATION_VIEW_ALL))
  const feedbackOn =
    isProductEnabled(flags, 'feedback') && can(actor, PERMISSIONS.POST_VIEW_PRIVATE)
  const changelogOn =
    isProductEnabled(flags, 'changelog') && can(actor, PERMISSIONS.CHANGELOG_VIEW_DRAFT)
  const helpOn = isProductEnabled(flags, 'helpCenter') && can(actor, PERMISSIONS.HELP_CENTER_MANAGE)

  const [support, feedback, changelog, help, momentum] = await Promise.all([
    supportOn
      ? loadSupport(actor, viewerId, now).catch((err) => {
          log.error({ err }, 'overview support failed')
          return failedSupport()
        })
      : Promise.resolve(disabledSupport()),
    feedbackOn
      ? loadFeedback(viewerId, now).catch((err) => {
          log.error({ err }, 'overview feedback failed')
          return failedFeedback()
        })
      : Promise.resolve(disabledFeedback()),
    changelogOn
      ? loadChangelog(now).catch((err) => {
          log.error({ err }, 'overview changelog failed')
          return failedChangelog()
        })
      : Promise.resolve(disabledChangelog()),
    helpOn
      ? loadHelpCenter().catch((err) => {
          log.error({ err }, 'overview help center failed')
          return failedHelp()
        })
      : Promise.resolve(disabledHelp()),
    feedbackOn
      ? loadMomentum(now).catch((err) => {
          log.error({ err }, 'overview momentum failed')
          return [] as OverviewMomentumItem[]
        })
      : Promise.resolve([] as OverviewMomentumItem[]),
  ])

  const metrics = buildOverviewMetrics({
    support: supportOn
      ? { waitingCount: support.waitingCount, waitingLink: support.waitingLink }
      : undefined,
    feedback: feedbackOn
      ? {
          reviewCount: feedback.reviewCount,
          completeCount: feedback.completeCount,
          reviewLink: feedback.reviewLink,
          completeLink: feedback.completeLink,
        }
      : undefined,
    help: helpOn ? { draftCount: help.draftCount, draftLink: help.draftLink } : undefined,
  })

  return {
    metrics,
    attention: mixAttention(
      [support.attention, feedback.attention, feedback.announce],
      ATTENTION_LIMIT
    ),
    momentum,
    publishing: [...changelog.items, ...help.items],
    sections: {
      support: support.section,
      feedback: feedback.section,
      changelog: changelog.section,
      helpCenter: help.section,
    },
  }
}

function enabledSection(): OverviewSectionState {
  return { enabled: true, error: null }
}
function disabledSection(): OverviewSectionState {
  return { enabled: false, error: null }
}
function errorSection(): OverviewSectionState {
  return { enabled: true, error: 'Couldn’t load this section.' }
}

function disabledSupport() {
  return {
    section: disabledSection(),
    attention: [] as OverviewAttentionItem[],
    waitingCount: 0,
    waitingLink: { to: '/admin/inbox', search: { sort: 'waiting' } } satisfies OverviewLink,
  }
}
function failedSupport() {
  return { ...disabledSupport(), section: errorSection() }
}
function disabledFeedback() {
  return {
    section: disabledSection(),
    attention: [] as OverviewAttentionItem[],
    announce: [] as OverviewAttentionItem[],
    reviewCount: 0,
    completeCount: 0,
    reviewLink: null as OverviewLink | null,
    completeLink: null as OverviewLink | null,
  }
}
function failedFeedback() {
  return { ...disabledFeedback(), section: errorSection() }
}
function disabledChangelog() {
  return { section: disabledSection(), items: [] as OverviewPublishItem[] }
}
function failedChangelog() {
  return { ...disabledChangelog(), section: errorSection() }
}
function disabledHelp() {
  return {
    section: disabledSection(),
    items: [] as OverviewPublishItem[],
    draftCount: 0,
    draftLink: { to: '/admin/help-center', search: { status: 'draft' } } satisfies OverviewLink,
  }
}
function failedHelp() {
  return { ...disabledHelp(), section: errorSection() }
}

async function loadSupport(actor: Actor, viewerId: PrincipalId | null, now: Date) {
  const visibility = conversationFilter(actor)
  const waitingLink: OverviewLink = { to: '/admin/inbox', search: { sort: 'waiting' } }

  const conditions = and(
    visibility,
    isNotNull(conversations.waitingSince),
    ne(conversations.status, 'closed')
  )

  const [totals] = await db.select({ waitingCount: count() }).from(conversations).where(conditions)

  const rows = await db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      lastMessagePreview: conversations.lastMessagePreview,
      priority: conversations.priority,
      waitingSince: conversations.waitingSince,
      assignedAgentPrincipalId: conversations.assignedAgentPrincipalId,
      visitorName: principal.displayName,
    })
    .from(conversations)
    .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
    .where(conditions)
    .orderBy(asc(conversations.waitingSince), desc(conversations.lastMessageAt))
    .limit(40)

  const agentIds = [
    ...new Set(
      rows.map((row) => row.assignedAgentPrincipalId).filter((id): id is PrincipalId => Boolean(id))
    ),
  ]
  const agents =
    agentIds.length > 0
      ? await db
          .select({ id: principal.id, displayName: principal.displayName })
          .from(principal)
          .where(inArray(principal.id, agentIds))
      : []
  const agentName = new Map(agents.map((row) => [row.id, row.displayName]))

  const ranked = rows
    .map((row) => {
      const assigned = Boolean(row.assignedAgentPrincipalId)
      const mine = viewerId != null && row.assignedAgentPrincipalId === viewerId
      const priority = row.priority as ConversationPriority
      const { reason, tone } = supportAttentionReason({ priority, assigned })
      const waitingIso = toIsoStringOrNull(row.waitingSince)
      const ownerName = row.assignedAgentPrincipalId
        ? (agentName.get(row.assignedAgentPrincipalId) ?? null)
        : null
      const visitor = row.visitorName?.trim() || 'Customer'
      const wait = waitingIso ? formatCompactAge(waitingIso, now.getTime()) : ''
      const reasonColor =
        priority === 'high' || priority === 'urgent' ? priorityMeta(priority).color : null
      return {
        rank: supportAttentionRank({ priority, assigned, mine }),
        waitingSince: waitingIso,
        item: {
          id: row.id,
          kind: 'support' as const,
          entity: 'conversation' as const,
          title: conversationTitle(row.subject, row.lastMessagePreview),
          link: { to: '/admin/inbox', search: { i: row.id } },
          reason,
          reasonTone: tone,
          reasonColor,
          meta: [visitor, wait ? `waiting ${wait}` : null].filter(Boolean).join(' · '),
          ownerName,
          ownerInitials: ownerInitials(ownerName),
          mine,
        } satisfies OverviewAttentionItem,
      }
    })
    .sort((a, b) => a.rank - b.rank || (a.waitingSince ?? '').localeCompare(b.waitingSince ?? ''))

  return {
    section: enabledSection(),
    attention: ranked.slice(0, ATTENTION_LIMIT).map((row) => row.item),
    waitingCount: Number(totals?.waitingCount ?? 0),
    waitingLink,
  }
}

type FeedbackRow = {
  id: PostId
  title: string
  at: Date
  boardName: string
  statusName: string
  statusColor: string
  ownerPrincipalId: PrincipalId | null
  ownerName: string | null
}

async function loadFeedback(viewerId: PrincipalId | null, now: Date) {
  const defaultStatus = await db.query.postStatuses.findFirst({
    where: and(eq(postStatuses.isDefault, true), isNull(postStatuses.deletedAt)),
    columns: { id: true, name: true, slug: true },
  })
  const completeStatuses = await db
    .select({ id: postStatuses.id, name: postStatuses.name, slug: postStatuses.slug })
    .from(postStatuses)
    .where(and(eq(postStatuses.category, 'complete'), isNull(postStatuses.deletedAt)))

  const livePost = and(isNull(posts.deletedAt), isNull(posts.canonicalPostId))

  const reviewLink: OverviewLink = defaultStatus
    ? { to: '/admin/feedback', search: { status: [defaultStatus.slug] } }
    : { to: '/admin/feedback' }
  const completeSlugs = completeStatuses.map((status) => status.slug)
  const completeLink: OverviewLink =
    completeSlugs.length > 0
      ? { to: '/admin/feedback', search: { status: completeSlugs } }
      : { to: '/admin/feedback' }

  const rowShape = (at: typeof posts.createdAt | typeof posts.updatedAt) => ({
    id: posts.id,
    title: posts.title,
    at,
    boardName: boards.name,
    statusName: postStatuses.name,
    statusColor: postStatuses.color,
    ownerPrincipalId: posts.ownerPrincipalId,
    ownerName: principal.displayName,
  })

  let reviewCount = 0
  let reviewRows: FeedbackRow[] = []
  if (defaultStatus) {
    const where = and(livePost, eq(posts.statusId, defaultStatus.id))
    const [countRow] = await db.select({ value: count() }).from(posts).where(where)
    reviewCount = Number(countRow?.value ?? 0)

    reviewRows = await db
      .select(rowShape(posts.createdAt))
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .innerJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .leftJoin(principal, eq(principal.id, posts.ownerPrincipalId))
      .where(where)
      .orderBy(desc(posts.createdAt))
      .limit(ATTENTION_LIMIT)
  }

  let completeCount = 0
  let completeRows: FeedbackRow[] = []
  if (completeStatuses.length > 0) {
    const completeIds = completeStatuses.map((status) => status.id)
    const noChangelog = notExists(
      db
        .select({ postId: changelogEntryPosts.postId })
        .from(changelogEntryPosts)
        .where(eq(changelogEntryPosts.postId, posts.id))
    )
    const where = and(livePost, inArray(posts.statusId, completeIds), noChangelog)
    const [countRow] = await db.select({ value: count() }).from(posts).where(where)
    completeCount = Number(countRow?.value ?? 0)

    completeRows = await db
      .select(rowShape(posts.updatedAt))
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .innerJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .leftJoin(principal, eq(principal.id, posts.ownerPrincipalId))
      .where(where)
      .orderBy(desc(posts.updatedAt))
      .limit(ATTENTION_LIMIT)
  }

  const toItem =
    (kind: 'feedback' | 'publishing', tone: 'info' | 'success') =>
    (row: FeedbackRow): OverviewAttentionItem => ({
      id: row.id,
      kind,
      entity: 'post',
      title: row.title,
      link: { to: '/admin', search: { post: row.id } },
      reason: row.statusName,
      reasonTone: tone,
      reasonColor: row.statusColor,
      meta: `${row.boardName} · ${formatCompactAge(toIsoString(row.at), now.getTime())}`,
      ownerName: row.ownerName,
      ownerInitials: ownerInitials(row.ownerName),
      mine: viewerId != null && row.ownerPrincipalId === viewerId,
    })

  return {
    section: enabledSection(),
    attention: viewerFirst(reviewRows.map(toItem('feedback', 'info'))),
    announce: viewerFirst(completeRows.map(toItem('publishing', 'success'))),
    reviewCount,
    completeCount,
    reviewLink,
    completeLink,
  }
}

async function loadMomentum(now: Date): Promise<OverviewMomentumItem[]> {
  const since = new Date(now.getTime() - WEEK_MS)
  const voteDelta = sql<number>`count(${postVotes.id})::int`
  const rows = await db
    .select({ postId: posts.id, title: posts.title, votesLast7d: voteDelta })
    .from(posts)
    .innerJoin(postVotes, and(eq(postVotes.postId, posts.id), gte(postVotes.createdAt, since)))
    .where(and(isNull(posts.deletedAt), isNull(posts.canonicalPostId)))
    .groupBy(posts.id, posts.title)
    .orderBy(desc(voteDelta))
    .limit(MOMENTUM_LIMIT)

  return rows.map((row) => ({
    postId: row.postId,
    entity: 'post' as const,
    title: row.title,
    votesLast7d: Number(row.votesLast7d),
    link: { to: '/admin', search: { post: row.postId } },
  }))
}

async function loadChangelog(now: Date) {
  const rows = await db
    .select({
      id: changelogEntries.id,
      title: changelogEntries.title,
      publishedAt: changelogEntries.publishedAt,
      authorName: principal.displayName,
    })
    .from(changelogEntries)
    .leftJoin(principal, eq(principal.id, changelogEntries.principalId))
    .where(
      and(
        isNull(changelogEntries.deletedAt),
        or(isNull(changelogEntries.publishedAt), gt(changelogEntries.publishedAt, now))
      )
    )
    .orderBy(desc(changelogEntries.updatedAt))
    .limit(PUBLISH_LIMIT)

  const items: OverviewPublishItem[] = rows.map((row) => {
    const scheduled = computeStatus(row.publishedAt) === 'scheduled' && row.publishedAt
    return {
      id: row.id,
      product: 'changelog',
      entity: 'changelog',
      title: row.title,
      link: { to: '/admin', search: { entry: row.id } },
      status: scheduled ? 'scheduled' : 'draft',
      meta: scheduled
        ? formatCompactAge(toIsoString(row.publishedAt!), now.getTime())
        : (row.authorName?.trim() ?? ''),
    }
  })

  return { section: enabledSection(), items }
}

async function loadHelpCenter() {
  const draftLink: OverviewLink = { to: '/admin/help-center', search: { status: 'draft' } }
  const conditions = and(
    isNull(helpCenterArticles.deletedAt),
    isNull(helpCenterArticles.publishedAt)
  )

  const [countRow] = await db.select({ value: count() }).from(helpCenterArticles).where(conditions)
  const draftCount = Number(countRow?.value ?? 0)

  const drafts = await db
    .select({
      id: helpCenterArticles.id,
      title: helpCenterArticles.title,
      authorName: principal.displayName,
    })
    .from(helpCenterArticles)
    .innerJoin(principal, eq(principal.id, helpCenterArticles.principalId))
    .where(conditions)
    .orderBy(desc(helpCenterArticles.updatedAt))
    .limit(PUBLISH_LIMIT)

  const items: OverviewPublishItem[] = drafts.map((row) => ({
    id: row.id,
    product: 'helpCenter',
    entity: 'article',
    title: row.title,
    link: { to: '/admin/help-center/articles/$articleId', params: { articleId: row.id } },
    status: 'draft',
    meta: row.authorName?.trim() ?? '',
  }))

  return { section: enabledSection(), items, draftCount, draftLink }
}
