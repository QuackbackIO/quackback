/**
 * Shared `@/lib/server/db` mock harness for the principal-merge suites
 * (principals/__tests__/principal-repoint.test.ts and
 * auth/__tests__/merge-anonymous.test.ts).
 *
 * Operations are tracked in order so step sequencing and conflict handling
 * can be asserted. Table stubs carry their real SQL names in `__name`.
 * Because this module is a singleton in vitest's module registry, the test's
 * `vi.mock('@/lib/server/db', ...)` factory and the test body share the same
 * spies and operations log:
 *
 *   vi.mock('@/lib/server/db', async () =>
 *     (await import('@/lib/server/__tests__/principal-merge-db-mock')).mockDbModule()
 *   )
 */
import { vi, type Mock } from 'vitest'

export const operations: string[] = []

export const mockSelectWhere: Mock = vi.fn()
export const mockSelectFrom: Mock = vi.fn(() => ({ where: mockSelectWhere }))

export const mockDeleteWhere: Mock = vi.fn()
export const mockUpdateWhere: Mock = vi.fn()
export const mockUpdateSet: Mock = vi.fn((_values?: unknown) => ({ where: mockUpdateWhere }))

interface MockTx {
  select: (...args: unknown[]) => { from: Mock }
  delete: (table: { __name?: string }) => { where: Mock }
  update: (table: { __name?: string }) => { set: Mock }
}

export const mockTx: MockTx = {
  select: (..._args: unknown[]) => ({ from: mockSelectFrom }),
  delete: (table: { __name?: string }) => {
    operations.push(`delete:${table.__name || 'unknown'}`)
    return { where: mockDeleteWhere }
  },
  update: (table: { __name?: string }) => {
    operations.push(`update:${table.__name || 'unknown'}`)
    return { set: mockUpdateSet }
  },
}

// The transaction function just calls the callback with itself (same API)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mockTransaction: Mock = vi.fn(async (fn: any) => fn(mockTx))

/** Reset the shared spies + operations log; call from beforeEach. */
export function resetDbMockState() {
  vi.clearAllMocks()
  operations.length = 0
  mockSelectWhere.mockResolvedValue([])
  mockDeleteWhere.mockResolvedValue(undefined)
  mockUpdateWhere.mockResolvedValue(undefined)
}

/** Ops for one table, in issue order. */
export function opsFor(table: string): string[] {
  return operations.filter((op) => op.endsWith(`:${table}`))
}

/** The full mocked `@/lib/server/db` module. */
export function mockDbModule(): Record<string, unknown> {
  return {
    db: {
      transaction: (fn: unknown) => mockTransaction(fn),
    },
    postVotes: {
      principalId: 'postVotes.principalId',
      postId: 'postVotes.postId',
      __name: 'post_votes',
    },
    postCommentReactions: {
      principalId: 'postCommentReactions.principalId',
      commentId: 'postCommentReactions.commentId',
      emoji: 'postCommentReactions.emoji',
      __name: 'post_comment_reactions',
    },
    postComments: {
      principalId: 'postComments.principalId',
      id: 'postComments.id',
      __name: 'post_comments',
    },
    posts: { principalId: 'posts.principalId', __name: 'posts' },
    postEditHistory: {
      editorPrincipalId: 'postEditHistory.editorPrincipalId',
      __name: 'post_edit_history',
    },
    postCommentEditHistory: {
      editorPrincipalId: 'postCommentEditHistory.editorPrincipalId',
      __name: 'post_comment_edit_history',
    },
    postActivity: { principalId: 'postActivity.principalId', __name: 'post_activity' },
    conversations: {
      visitorPrincipalId: 'conversations.visitorPrincipalId',
      __name: 'conversations',
    },
    conversationMessages: {
      principalId: 'conversationMessages.principalId',
      __name: 'conversation_messages',
    },
    conversationSummaries: {
      visitorPrincipalId: 'conversationSummaries.visitorPrincipalId',
      __name: 'conversation_summaries',
    },
    postSubscriptions: {
      principalId: 'postSubscriptions.principalId',
      postId: 'postSubscriptions.postId',
      __name: 'post_subscriptions',
    },
    inAppNotifications: {
      principalId: 'inAppNotifications.principalId',
      commentId: 'inAppNotifications.commentId',
      title: 'inAppNotifications.title',
      __name: 'in_app_notifications',
    },
    pageViews: { principalId: 'pageViews.principalId', __name: 'page_views' },
    visitorDevices: { principalId: 'visitorDevices.principalId', __name: 'visitor_devices' },
    userSegments: {
      principalId: 'userSegments.principalId',
      segmentId: 'userSegments.segmentId',
      addedBy: 'userSegments.addedBy',
      __name: 'user_segments',
    },
    helpCenterArticleFeedback: {
      principalId: 'helpCenterArticleFeedback.principalId',
      articleId: 'helpCenterArticleFeedback.articleId',
      __name: 'kb_article_feedback',
    },
    channelIdentities: {
      principalId: 'channelIdentities.principalId',
      channel: 'channelIdentities.channel',
      externalId: 'channelIdentities.externalId',
      __name: 'channel_identities',
    },
    tickets: {
      requesterPrincipalId: 'tickets.requesterPrincipalId',
      __name: 'tickets',
    },
    workflowRuns: {
      subjectPrincipalId: 'workflowRuns.subjectPrincipalId',
      __name: 'workflow_runs',
    },
    workflowRunEvents: {
      subjectPrincipalId: 'workflowRunEvents.subjectPrincipalId',
      __name: 'workflow_run_events',
    },
    changelogSubscriptions: {
      principalId: 'changelogSubscriptions.principalId',
      __name: 'changelog_subscriptions',
    },
    statusSubscriptions: {
      principalId: 'statusSubscriptions.principalId',
      __name: 'status_subscriptions',
    },
    principal: {
      id: 'principal.id',
      userId: 'principal.userId',
      contactEmail: 'principal.contactEmail',
      companyId: 'principal.companyId',
      blockedAt: 'principal.blockedAt',
      blockedByPrincipalId: 'principal.blockedByPrincipalId',
      __name: 'principal',
    },
    session: { userId: 'session.userId', __name: 'session' },
    user: { id: 'user.id', __name: 'user' },
    account: { userId: 'account.userId', __name: 'account' },
    eq: vi.fn((col: unknown, val: unknown) => ({ _type: 'eq', col, val })),
    and: vi.fn((...args: unknown[]) => ({ _type: 'and', args })),
    ne: vi.fn((col: unknown, val: unknown) => ({ _type: 'ne', col, val })),
    isNull: vi.fn((col: unknown) => ({ _type: 'isNull', col })),
    inArray: vi.fn((col: unknown, vals: unknown) => ({ _type: 'inArray', col, vals })),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({ _type: 'sql', strings, values }),
      { raw: (s: string) => ({ _type: 'sql_raw', value: s }) }
    ),
  }
}
