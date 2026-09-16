/* oxlint-disable max-lines -- one aggregation over support, feedback, changelog, and help center */
/**
 * Admin Overview aggregation. Each section is gated on the real product flag
 * and permission, then reads the same columns the product lists already use.
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
  lte,
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
  postActivity,
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
  conversationTitle,
  describeOverviewActivity,
  formatCompactAge,
  ownerInitials,
  mixAttention,
  supportAttentionRank,
  supportAttentionReason,
  type AdminOverviewData,
  type OverviewActivityItem,
  type OverviewAttentionItem,
  type OverviewMetric,
  type OverviewMomentumItem,
  type OverviewLink,
  type OverviewPublishItem,
  type OverviewPublishStatus,
  type OverviewScope,
  type OverviewSectionState,
} from '@/lib/shared/admin-overview'
import type { ConversationPriority } from '@/lib/shared/conversation/types'

const log = logger.child({ component: 'admin-overview' })

const ATTENTION_LIMIT = 8
const MOMENTUM_LIMIT = 5
const PUBLISH_LIMIT = 3
const ACTIVITY_LIMIT = 6
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export async function getAdminOverview(input: {
  scope: OverviewScope
  actor: Actor
  flags: Partial<FeatureFlags> | undefined
}): Promise<AdminOverviewData> {
  const { scope, actor, flags } = input
  const mineId = scope === 'mine' ? actor.principalId : null
  const now = new Date()

  const supportOn =
    isProductEnabled(flags, 'support') &&
    (can(actor, PERMISSIONS.CONVERSATION_VIEW) || can(actor, PERMISSIONS.CONVERSATION_VIEW_ALL))
  const feedbackOn =
    isProductEnabled(flags, 'feedback') && can(actor, PERMISSIONS.POST_VIEW_PRIVATE)
  const changelogOn =
    isProductEnabled(flags, 'changelog') && can(actor, PERMISSIONS.CHANGELOG_VIEW_DRAFT)
  const helpOn = isProductEnabled(flags, 'helpCenter') && can(actor, PERMISSIONS.HELP_CENTER_MANAGE)

  const [support, feedback, changelog, help, momentum, activity] = await Promise.all([
    supportOn
      ? loadSupport(actor, mineId, now).catch((err) => {
          log.error({ err }, 'overview support failed')
          return failedSupport()
        })
      : Promise.resolve(disabledSupport()),
    feedbackOn
      ? loadFeedback(mineId, now).catch((err) => {
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
      ? loadHelpCenter(mineId, now).catch((err) => {
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
    loadActivity({
      feedbackOn,
      changelogOn,
      helpOn,
      supportOn,
      actor,
      now,
    }).catch((err) => {
      log.error({ err }, 'overview activity failed')
      return [] as OverviewActivityItem[]
    }),
  ])

  const metrics: OverviewMetric[] = []
  if (supportOn) {
    metrics.push({
      key: 'waiting',
      label: 'Waiting for reply',
      count: support.waitingCount,
      unit: 'open',
      hint:
        support.highPriorityCount > 0
          ? `${support.highPriorityCount} high priority`
          : 'Customer waiting on a teammate',
      hintTone: support.highPriorityCount > 0 ? 'urgent' : 'neutral',
      link: support.waitingLink,
      filter: 'support',
    })
  }
  if (feedbackOn && feedback.reviewLink) {
    metrics.push({
      key: 'feedback',
      label: 'Feedback to review',
      count: feedback.reviewCount,
      unit: 'open',
      hint: feedback.defaultStatusName
        ? `On ${feedback.defaultStatusName}`
        : 'Default status posts',
      hintTone: 'neutral',
      link: feedback.reviewLink,
      filter: 'feedback',
    })
  }
  if (feedbackOn && feedback.completeLink) {
    metrics.push({
      key: 'complete',
      label: 'Complete, no changelog',
      count: feedback.completeCount,
      unit: 'open',
      hint: 'Complete status with no linked changelog',
      hintTone: 'neutral',
      link: feedback.completeLink,
      filter: 'publishing',
    })
  }
  if (helpOn) {
    metrics.push({
      key: 'articles',
      label: scope === 'mine' ? 'Your article drafts' : 'Article drafts',
      count: help.draftCount,
      unit: 'in progress',
      hint: 'Continue in Help Center',
      hintTone: 'neutral',
      link: help.draftLink,
      filter: 'articles',
    })
  }

  return {
    generatedAt: now.toISOString(),
    scope,
    metrics,
    attention: mixAttention(
      [support.attention, feedback.attention, feedback.announce],
      ATTENTION_LIMIT
    ),
    momentum,
    publishing: {
      changelog: changelog.items,
      helpCenter: help.items,
    },
    activity,
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
  return { enabled: true, error: 'Couldn’t load this section. Try again.' }
}

function disabledSupport() {
  return {
    section: disabledSection(),
    attention: [] as OverviewAttentionItem[],
    waitingCount: 0,
    highPriorityCount: 0,
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
    defaultStatusName: null as string | null,
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

async function loadSupport(actor: Actor, mineId: PrincipalId | null, now: Date) {
  const visibility = conversationFilter(actor)
  const waitingLink: OverviewLink = {
    to: '/admin/inbox',
    search: mineId != null ? { view: 'mine', sort: 'waiting' } : { sort: 'waiting' },
  }

  const conditions = [
    visibility,
    isNotNull(conversations.waitingSince),
    ne(conversations.status, 'closed'),
  ]
  if (mineId) conditions.push(eq(conversations.assignedAgentPrincipalId, mineId))

  const [totals] = await db
    .select({
      waitingCount: count(),
      highPriorityCount: sql<number>`count(*) filter (where ${conversations.priority} in ('high', 'urgent'))::int`,
    })
    .from(conversations)
    .where(and(...conditions))

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
    .where(and(...conditions))
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
        rank: supportAttentionRank({
          priority,
          assigned,
          waitingSince: waitingIso,
        }),
        waitingSince: waitingIso,
        item: {
          id: row.id,
          kind: 'support' as const,
          title: conversationTitle(row.subject, row.lastMessagePreview),
          link: { to: '/admin/inbox', search: { i: row.id } },
          reason,
          reasonTone: tone,
          reasonColor,
          meta: [visitor, wait ? `Waiting ${wait}` : null].filter(Boolean).join(' · '),
          ownerName,
          ownerInitials: ownerInitials(ownerName),
          visitorName: visitor,
          waitingSince: waitingIso,
        } satisfies OverviewAttentionItem,
      }
    })
    .sort((a, b) => a.rank - b.rank || (a.waitingSince ?? '').localeCompare(b.waitingSince ?? ''))

  return {
    section: enabledSection(),
    attention: ranked.slice(0, ATTENTION_LIMIT).map((row) => row.item),
    waitingCount: Number(totals?.waitingCount ?? 0),
    highPriorityCount: Number(totals?.highPriorityCount ?? 0),
    waitingLink,
  }
}

async function loadFeedback(mineId: PrincipalId | null, now: Date) {
  const defaultStatus = await db.query.postStatuses.findFirst({
    where: and(eq(postStatuses.isDefault, true), isNull(postStatuses.deletedAt)),
    columns: { id: true, name: true, slug: true },
  })
  const completeStatuses = await db
    .select({
      id: postStatuses.id,
      name: postStatuses.name,
      slug: postStatuses.slug,
    })
    .from(postStatuses)
    .where(and(eq(postStatuses.category, 'complete'), isNull(postStatuses.deletedAt)))

  const liveParts = [isNull(posts.deletedAt), isNull(posts.canonicalPostId)]
  if (mineId) liveParts.push(eq(posts.ownerPrincipalId, mineId))
  const livePost = and(...liveParts)

  const reviewLink: OverviewLink | null = defaultStatus
    ? {
        to: '/admin/feedback',
        search: {
          status: [defaultStatus.slug],
          owner: mineId ?? undefined,
        },
      }
    : { to: '/admin/feedback' }
  const completeSlugs = completeStatuses.map((status) => status.slug)
  const completeLink: OverviewLink | null =
    completeSlugs.length > 0
      ? {
          to: '/admin/feedback',
          search: {
            status: completeSlugs,
            owner: mineId ?? undefined,
          },
        }
      : { to: '/admin/feedback' }

  let reviewCount = 0
  let reviewRows: Array<{
    id: PostId
    title: string
    voteCount: number
    createdAt: Date
    boardName: string
    statusName: string
    statusColor: string
    ownerName: string | null
  }> = []

  if (defaultStatus) {
    const [countRow] = await db
      .select({ value: count() })
      .from(posts)
      .where(and(livePost, eq(posts.statusId, defaultStatus.id)))
    reviewCount = Number(countRow?.value ?? 0)

    reviewRows = await db
      .select({
        id: posts.id,
        title: posts.title,
        voteCount: posts.voteCount,
        createdAt: posts.createdAt,
        boardName: boards.name,
        statusName: postStatuses.name,
        statusColor: postStatuses.color,
        ownerName: principal.displayName,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .innerJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .leftJoin(principal, eq(principal.id, posts.ownerPrincipalId))
      .where(and(livePost, eq(posts.statusId, defaultStatus.id)))
      .orderBy(desc(posts.createdAt))
      .limit(ATTENTION_LIMIT)
  }

  let completeCount = 0
  let completeRows: typeof reviewRows = []
  if (completeStatuses.length > 0) {
    const completeIds = completeStatuses.map((status) => status.id)
    const noChangelog = notExists(
      db
        .select({ postId: changelogEntryPosts.postId })
        .from(changelogEntryPosts)
        .where(eq(changelogEntryPosts.postId, posts.id))
    )
    const [countRow] = await db
      .select({ value: count() })
      .from(posts)
      .where(and(livePost, inArray(posts.statusId, completeIds), noChangelog))
    completeCount = Number(countRow?.value ?? 0)

    completeRows = await db
      .select({
        id: posts.id,
        title: posts.title,
        voteCount: posts.voteCount,
        createdAt: posts.updatedAt,
        boardName: boards.name,
        statusName: postStatuses.name,
        statusColor: postStatuses.color,
        ownerName: principal.displayName,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .innerJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .leftJoin(principal, eq(principal.id, posts.ownerPrincipalId))
      .where(and(livePost, inArray(posts.statusId, completeIds), noChangelog))
      .orderBy(desc(posts.updatedAt))
      .limit(ATTENTION_LIMIT)
  }

  const attention: OverviewAttentionItem[] = reviewRows.map((row) => ({
    id: row.id,
    kind: 'feedback',
    title: row.title,
    link: { to: '/admin/feedback', search: { post: row.id } },
    reason: row.statusName,
    reasonTone: 'info',
    reasonColor: row.statusColor,
    meta: [
      row.boardName,
      `${row.voteCount} votes`,
      `Created ${formatCompactAge(toIsoString(row.createdAt), now.getTime())} ago`,
    ].join(' · '),
    ownerName: row.ownerName,
    ownerInitials: ownerInitials(row.ownerName),
    voteCount: row.voteCount,
    boardName: row.boardName,
    createdAt: toIsoString(row.createdAt),
  }))

  const announce: OverviewAttentionItem[] = completeRows.map((row) => ({
    id: row.id,
    kind: 'publishing',
    title: row.title,
    link: { to: '/admin/feedback', search: { post: row.id } },
    reason: row.statusName,
    reasonTone: 'success',
    reasonColor: row.statusColor,
    meta: [
      row.boardName,
      `${row.voteCount} votes`,
      'No linked changelog',
      `Updated ${formatCompactAge(toIsoString(row.createdAt), now.getTime())} ago`,
    ].join(' · '),
    ownerName: row.ownerName,
    ownerInitials: ownerInitials(row.ownerName),
    voteCount: row.voteCount,
    boardName: row.boardName,
    createdAt: toIsoString(row.createdAt),
  }))

  return {
    section: enabledSection(),
    attention,
    announce,
    reviewCount,
    completeCount,
    defaultStatusName: defaultStatus?.name ?? null,
    reviewLink,
    completeLink,
  }
}

async function loadMomentum(now: Date): Promise<OverviewMomentumItem[]> {
  const since = new Date(now.getTime() - WEEK_MS)
  const voteDelta = sql<number>`count(${postVotes.id})::int`
  const rows = await db
    .select({
      postId: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      boardName: boards.name,
      statusName: postStatuses.name,
      statusColor: postStatuses.color,
      votesLast7d: voteDelta,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .innerJoin(postVotes, and(eq(postVotes.postId, posts.id), gte(postVotes.createdAt, since)))
    .where(and(isNull(posts.deletedAt), isNull(posts.canonicalPostId)))
    .groupBy(
      posts.id,
      posts.title,
      posts.voteCount,
      boards.name,
      postStatuses.name,
      postStatuses.color
    )
    .orderBy(desc(voteDelta))
    .limit(MOMENTUM_LIMIT)

  return rows.map((row) => ({
    postId: row.postId,
    title: row.title,
    boardName: row.boardName,
    statusName: row.statusName ?? 'No status',
    statusColor: row.statusColor,
    voteCount: row.voteCount,
    votesLast7d: Number(row.votesLast7d),
    link: { to: '/admin/feedback', search: { post: row.postId } },
  }))
}

async function loadChangelog(now: Date) {
  const rows = await db
    .select({
      id: changelogEntries.id,
      title: changelogEntries.title,
      publishedAt: changelogEntries.publishedAt,
      updatedAt: changelogEntries.updatedAt,
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
    .limit(PUBLISH_LIMIT + 2)

  const ids = rows.map((row) => row.id)
  const linked =
    ids.length > 0
      ? await db
          .select({
            changelogEntryId: changelogEntryPosts.changelogEntryId,
            value: count(),
          })
          .from(changelogEntryPosts)
          .where(inArray(changelogEntryPosts.changelogEntryId, ids))
          .groupBy(changelogEntryPosts.changelogEntryId)
      : []
  const linkedCount = new Map(linked.map((row) => [row.changelogEntryId, Number(row.value)]))

  const items: OverviewPublishItem[] = rows.slice(0, PUBLISH_LIMIT).map((row) => {
    const status = computeStatus(row.publishedAt) as OverviewPublishStatus
    const author = row.authorName?.trim()
    const when =
      status === 'scheduled' && row.publishedAt
        ? formatCompactAge(toIsoString(row.publishedAt), now.getTime())
        : `edited ${formatCompactAge(toIsoString(row.updatedAt), now.getTime())} ago`
    const links = linkedCount.get(row.id) ?? 0
    return {
      id: row.id,
      product: 'changelog',
      title: row.title,
      link: { to: '/admin/changelog', search: { entry: row.id } },
      status,
      meta: ['Changelog', when, author, links > 0 ? `${links} linked posts` : null]
        .filter(Boolean)
        .join(' · '),
    }
  })

  return { section: enabledSection(), items }
}

async function loadHelpCenter(mineId: PrincipalId | null, now: Date) {
  const draftLink: OverviewLink = {
    to: '/admin/help-center',
    search: { status: 'draft' },
  }
  const conditions = [isNull(helpCenterArticles.deletedAt), isNull(helpCenterArticles.publishedAt)]
  if (mineId) conditions.push(eq(helpCenterArticles.principalId, mineId))

  const [countRow] = await db
    .select({ value: count() })
    .from(helpCenterArticles)
    .where(and(...conditions))
  const draftCount = Number(countRow?.value ?? 0)

  const drafts = await db
    .select({
      id: helpCenterArticles.id,
      title: helpCenterArticles.title,
      updatedAt: helpCenterArticles.updatedAt,
      authorName: principal.displayName,
    })
    .from(helpCenterArticles)
    .innerJoin(principal, eq(principal.id, helpCenterArticles.principalId))
    .where(and(...conditions))
    .orderBy(desc(helpCenterArticles.updatedAt))
    .limit(PUBLISH_LIMIT)

  const published = mineId
    ? []
    : await db
        .select({
          id: helpCenterArticles.id,
          title: helpCenterArticles.title,
          updatedAt: helpCenterArticles.publishedAt,
          authorName: principal.displayName,
        })
        .from(helpCenterArticles)
        .innerJoin(principal, eq(principal.id, helpCenterArticles.principalId))
        .where(
          and(
            isNull(helpCenterArticles.deletedAt),
            isNotNull(helpCenterArticles.publishedAt),
            lte(helpCenterArticles.publishedAt, now)
          )
        )
        .orderBy(desc(helpCenterArticles.publishedAt))
        .limit(1)

  const items: OverviewPublishItem[] = [
    ...drafts.map((row) => ({
      id: row.id,
      product: 'helpCenter' as const,
      title: row.title,
      link: {
        to: '/admin/help-center/articles/$articleId',
        params: { articleId: row.id },
      },
      status: 'draft' as const,
      meta: [
        'Help Center',
        row.authorName,
        `edited ${formatCompactAge(toIsoString(row.updatedAt), now.getTime())} ago`,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    ...published.map((row) => ({
      id: row.id,
      product: 'helpCenter' as const,
      title: row.title,
      link: {
        to: '/admin/help-center/articles/$articleId',
        params: { articleId: row.id },
      },
      status: 'published' as const,
      meta: [
        'Help Center',
        row.authorName,
        row.updatedAt
          ? `published ${formatCompactAge(toIsoString(row.updatedAt), now.getTime())} ago`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
  ]

  return { section: enabledSection(), items, draftCount, draftLink }
}

async function loadActivity(input: {
  feedbackOn: boolean
  changelogOn: boolean
  helpOn: boolean
  supportOn: boolean
  actor: Actor
  now: Date
}): Promise<OverviewActivityItem[]> {
  const since = new Date(input.now.getTime() - WEEK_MS)
  const events: OverviewActivityItem[] = []

  if (input.feedbackOn) {
    const rows = await db
      .select({
        id: postActivity.id,
        type: postActivity.type,
        metadata: postActivity.metadata,
        createdAt: postActivity.createdAt,
        postId: posts.id,
        title: posts.title,
        actorName: principal.displayName,
      })
      .from(postActivity)
      .innerJoin(posts, eq(posts.id, postActivity.postId))
      .leftJoin(principal, eq(principal.id, postActivity.principalId))
      .where(
        and(
          gte(postActivity.createdAt, since),
          isNull(posts.deletedAt),
          inArray(postActivity.type, ['status.changed', 'post.created', 'owner.assigned'])
        )
      )
      .orderBy(desc(postActivity.createdAt))
      .limit(ACTIVITY_LIMIT)

    for (const row of rows) {
      const metadata = (row.metadata ?? {}) as { toName?: string }
      events.push({
        id: row.id,
        actorName: row.actorName,
        actorInitials: ownerInitials(row.actorName),
        event: describeOverviewActivity({
          source: 'post',
          type: row.type,
          actorName: row.actorName,
          toName: metadata.toName,
        }),
        title: row.title,
        link: { to: '/admin/feedback', search: { post: row.postId } },
        at: toIsoString(row.createdAt),
      })
    }
  }

  if (input.changelogOn) {
    const rows = await db
      .select({
        id: changelogEntries.id,
        title: changelogEntries.title,
        publishedAt: changelogEntries.publishedAt,
        updatedAt: changelogEntries.updatedAt,
        actorName: principal.displayName,
      })
      .from(changelogEntries)
      .leftJoin(principal, eq(principal.id, changelogEntries.principalId))
      .where(and(isNull(changelogEntries.deletedAt), gte(changelogEntries.updatedAt, since)))
      .orderBy(desc(changelogEntries.updatedAt))
      .limit(4)

    for (const row of rows) {
      const status = computeStatus(row.publishedAt)
      if (status === 'draft') continue
      events.push({
        id: `changelog:${row.id}`,
        actorName: row.actorName,
        actorInitials: ownerInitials(row.actorName),
        event: describeOverviewActivity({
          source: 'changelog',
          status,
          actorName: row.actorName,
        }),
        title: row.title,
        link: { to: '/admin/changelog', search: { entry: row.id } },
        at: toIsoString(row.publishedAt ?? row.updatedAt),
      })
    }
  }

  if (input.helpOn) {
    const rows = await db
      .select({
        id: helpCenterArticles.id,
        title: helpCenterArticles.title,
        publishedAt: helpCenterArticles.publishedAt,
        actorName: principal.displayName,
      })
      .from(helpCenterArticles)
      .innerJoin(principal, eq(principal.id, helpCenterArticles.principalId))
      .where(
        and(
          isNull(helpCenterArticles.deletedAt),
          isNotNull(helpCenterArticles.publishedAt),
          gte(helpCenterArticles.publishedAt, since)
        )
      )
      .orderBy(desc(helpCenterArticles.publishedAt))
      .limit(4)

    for (const row of rows) {
      events.push({
        id: `article:${row.id}`,
        actorName: row.actorName,
        actorInitials: ownerInitials(row.actorName),
        event: describeOverviewActivity({
          source: 'article',
          published: true,
          actorName: row.actorName,
        }),
        title: row.title,
        link: {
          to: '/admin/help-center/articles/$articleId',
          params: { articleId: row.id },
        },
        at: toIsoString(row.publishedAt!),
      })
    }
  }

  if (input.supportOn) {
    const visibility = conversationFilter(input.actor)
    const rows = await db
      .select({
        id: conversations.id,
        subject: conversations.subject,
        lastMessagePreview: conversations.lastMessagePreview,
        resolvedAt: conversations.resolvedAt,
        actorName: principal.displayName,
      })
      .from(conversations)
      .leftJoin(principal, eq(principal.id, conversations.assignedAgentPrincipalId))
      .where(
        and(
          visibility,
          eq(conversations.status, 'closed'),
          isNotNull(conversations.resolvedAt),
          gte(conversations.resolvedAt, since)
        )
      )
      .orderBy(desc(conversations.resolvedAt))
      .limit(4)

    for (const row of rows) {
      events.push({
        id: `conversation:${row.id}`,
        actorName: row.actorName,
        actorInitials: ownerInitials(row.actorName),
        event: describeOverviewActivity({
          source: 'conversation',
          actorName: row.actorName,
        }),
        title: conversationTitle(row.subject, row.lastMessagePreview),
        link: { to: '/admin/inbox', search: { i: row.id } },
        at: toIsoString(row.resolvedAt!),
      })
    }
  }

  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_LIMIT)
}
