/**
 * Widget BFF handlers: widget auth in, site requireAuth never consulted,
 * each endpoint delegates to the shared run helper.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let schema: { parse: (v: unknown) => unknown } | null = null
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data?: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler({ data: schema ? schema.parse(args?.data) : args?.data })
    }
    fn.validator = (s: { parse: (v: unknown) => unknown }) => {
      schema = s
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => {
  const requireWidgetAuth = vi.fn()
  const getOptionalWidgetAuth = vi.fn()
  const requireAuth = vi.fn()
  const getOptionalAuth = vi.fn()
  const run = {
    listPublicPosts: vi.fn(),
    createPublicPost: vi.fn(),
    toggleVote: vi.fn(),
    getVotedPosts: vi.fn(),
    fetchPublicPostDetail: vi.fn(),
    fetchBoardCapabilities: vi.fn(),
    createComment: vi.fn(),
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
    sendConversationMessage: vi.fn(),
    getConversationPresence: vi.fn(),
    getWidgetTeamAvatars: vi.fn(),
    getMyConversation: vi.fn(),
    getMyConversations: vi.fn(),
    getMessengerUnread: vi.fn(),
    listConversationMessages: vi.fn(),
    markConversationRead: vi.fn(),
    sendConversationTyping: vi.fn(),
    submitCsat: vi.fn(),
    mintConversationStreamToken: vi.fn(),
    getMyTickets: vi.fn(),
    getMyTicketStageLabels: vi.fn(),
    getMyTicketForm: vi.fn(),
    getMyTicketWatchStatus: vi.fn(),
    getConversationLinkedTicket: vi.fn(),
    createMyTicket: vi.fn(),
    watchMyTicket: vi.fn(),
    unwatchMyTicket: vi.fn(),
    getPublicChangelog: vi.fn(),
    listPublicChangelogs: vi.fn(),
    getUserStats: vi.fn(),
    listPublicCategoriesForLocale: vi.fn(),
    listPublicArticlesForCategoryLocale: vi.fn(),
    getPublicArticleBySlugForLocale: vi.fn(),
    recordArticleFeedback: vi.fn(),
    listPublicArticles: vi.fn(),
    resolveHelpPublicViewer: vi.fn(),
    serializeCategory: vi.fn((c: unknown) => c),
    serializeArticle: vi.fn((a: unknown) => a),
  }
  return { requireWidgetAuth, getOptionalWidgetAuth, requireAuth, getOptionalAuth, run }
})

vi.mock('@/lib/server/functions/widget-auth', () => ({
  requireWidgetAuth: hoisted.requireWidgetAuth,
  getOptionalWidgetAuth: hoisted.getOptionalWidgetAuth,
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  getOptionalAuth: hoisted.getOptionalAuth,
  policyActorFromAuth: vi.fn(),
  hasAuthCredentials: vi.fn(),
}))
vi.mock('@/lib/server/functions/public-posts', () => ({
  runListPublicPosts: hoisted.run.listPublicPosts,
  runCreatePublicPost: hoisted.run.createPublicPost,
  runToggleVote: hoisted.run.toggleVote,
  runGetVotedPosts: hoisted.run.getVotedPosts,
}))
vi.mock('@/lib/server/functions/portal', () => ({
  runFetchPublicPostDetail: hoisted.run.fetchPublicPostDetail,
  runFetchBoardCapabilities: hoisted.run.fetchBoardCapabilities,
}))
vi.mock('@/lib/server/functions/comments', () => ({
  runCreateComment: hoisted.run.createComment,
  runAddReaction: hoisted.run.addReaction,
  runRemoveReaction: hoisted.run.removeReaction,
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  runSendConversationMessage: hoisted.run.sendConversationMessage,
  runGetConversationPresence: hoisted.run.getConversationPresence,
  runGetWidgetTeamAvatars: hoisted.run.getWidgetTeamAvatars,
  runGetMyConversation: hoisted.run.getMyConversation,
  runGetMyConversations: hoisted.run.getMyConversations,
  runGetMessengerUnread: hoisted.run.getMessengerUnread,
  runListConversationMessages: hoisted.run.listConversationMessages,
  runMarkConversationRead: hoisted.run.markConversationRead,
  runSendConversationTyping: hoisted.run.sendConversationTyping,
  runSubmitCsat: hoisted.run.submitCsat,
  runMintConversationStreamToken: hoisted.run.mintConversationStreamToken,
}))
vi.mock('@/lib/server/functions/tickets', () => ({
  runGetMyTickets: hoisted.run.getMyTickets,
  runGetMyTicketStageLabels: hoisted.run.getMyTicketStageLabels,
  runGetMyTicketForm: hoisted.run.getMyTicketForm,
  runGetMyTicketWatchStatus: hoisted.run.getMyTicketWatchStatus,
  runGetConversationLinkedTicket: hoisted.run.getConversationLinkedTicket,
  runCreateMyTicket: hoisted.run.createMyTicket,
  runWatchMyTicket: hoisted.run.watchMyTicket,
  runUnwatchMyTicket: hoisted.run.unwatchMyTicket,
}))
vi.mock('@/lib/server/functions/changelog', () => ({
  runGetPublicChangelog: hoisted.run.getPublicChangelog,
  runListPublicChangelogs: hoisted.run.listPublicChangelogs,
}))
vi.mock('@/lib/server/functions/user', () => ({
  runGetUserStats: hoisted.run.getUserStats,
}))
vi.mock('@/lib/server/functions/help-center', () => ({
  resolveHelpPublicViewer: hoisted.run.resolveHelpPublicViewer,
  serializeCategory: hoisted.run.serializeCategory,
  serializeArticle: hoisted.run.serializeArticle,
}))
vi.mock('@/lib/server/domains/help-center/help-center-locale.query', () => ({
  listPublicCategoriesForLocale: hoisted.run.listPublicCategoriesForLocale,
  listPublicArticlesForCategoryLocale: hoisted.run.listPublicArticlesForCategoryLocale,
  getPublicArticleByIdForLocale: vi.fn(),
  getPublicArticleBySlugForLocale: hoisted.run.getPublicArticleBySlugForLocale,
}))
vi.mock('@/lib/server/domains/help-center/help-center.article.query', () => ({
  listPublicArticles: hoisted.run.listPublicArticles,
}))
vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  recordArticleFeedback: hoisted.run.recordArticleFeedback,
}))
vi.mock('@/lib/shared/widget/article-ref', () => ({ canonicalArticleTypeId: () => null }))
vi.mock('@/lib/shared/widget/article-locale', () => ({
  withDefaultLocaleFallback: async (
    _locale: string,
    _fallback: string,
    load: (loc: string) => Promise<unknown>
  ) => ({ value: await load('en'), locale: 'en' }),
}))
vi.mock('@/lib/shared/errors', () => ({
  NotFoundError: class NotFoundError extends Error {},
}))

import {
  widgetListPublicPostsFn,
  widgetCreatePublicPostFn,
  widgetToggleVoteFn,
  widgetGetVotedPostsFn,
  widgetFetchPublicPostDetailFn,
  widgetFetchBoardCapabilitiesFn,
} from '../posts'
import { widgetCreateCommentFn, widgetAddReactionFn, widgetRemoveReactionFn } from '../comments'
import {
  widgetSendConversationMessageFn,
  widgetGetConversationPresenceFn,
  widgetGetTeamAvatarsFn,
  widgetGetMyConversationFn,
  widgetGetMyConversationsFn,
  widgetGetMessengerUnreadFn,
  widgetListConversationMessagesFn,
  widgetMarkConversationReadFn,
  widgetSendConversationTypingFn,
  widgetSubmitCsatFn,
  widgetMintConversationStreamTokenFn,
} from '../conversation'
import {
  widgetGetMyTicketsFn,
  widgetGetMyTicketStageLabelsFn,
  widgetGetMyTicketFormFn,
  widgetGetMyTicketWatchStatusFn,
  widgetGetConversationLinkedTicketFn,
  widgetCreateMyTicketFn,
  widgetWatchMyTicketFn,
  widgetUnwatchMyTicketFn,
} from '../tickets'
import { widgetGetPublicChangelogFn, widgetListPublicChangelogsFn } from '../changelog'
import { widgetGetUserStatsFn } from '../user'
import {
  widgetListPublicCategoriesFn,
  widgetListPublicArticlesForCategoryFn,
  widgetResolvePublicArticleRefFn,
  widgetRecordArticleFeedbackFn,
  widgetListPublicArticlesFn,
} from '../help'

const WIDGET_CTX = {
  principal: { id: 'principal_widget' },
  user: { id: 'user_widget', email: 'v@example.com', name: 'Visitor' },
  scope: 'widget',
  permissions: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireWidgetAuth.mockResolvedValue(WIDGET_CTX)
  hoisted.getOptionalWidgetAuth.mockResolvedValue(WIDGET_CTX)
  hoisted.requireAuth.mockRejectedValue(
    new Error('Access denied: Widget sessions cannot access this resource')
  )
  hoisted.getOptionalAuth.mockResolvedValue(null)
  hoisted.run.resolveHelpPublicViewer.mockResolvedValue({ principalId: 'principal_widget' })
  hoisted.run.serializeCategory.mockImplementation((c: unknown) => c)
  hoisted.run.serializeArticle.mockImplementation((a: unknown) => a)
  for (const fn of Object.values(hoisted.run)) {
    if (fn === hoisted.run.serializeCategory || fn === hoisted.run.serializeArticle) continue
    if (typeof fn.mockResolvedValue === 'function') fn.mockResolvedValue({ ok: true })
  }
  hoisted.run.listPublicArticles.mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
  hoisted.run.listPublicCategoriesForLocale.mockResolvedValue([{ id: 'cat_1' }])
  hoisted.run.listPublicArticlesForCategoryLocale.mockResolvedValue([{ id: 'art_1' }])
  hoisted.run.getPublicArticleBySlugForLocale.mockResolvedValue({
    id: 'art_1',
    helpfulCount: 0,
    notHelpfulCount: 0,
  })
  hoisted.run.recordArticleFeedback.mockResolvedValue('feedback_1')
  hoisted.run.getUserStats.mockResolvedValue({ ideas: 0, votes: 0, comments: 0 })
})

function expectWidgetAuthOnly() {
  expect(hoisted.requireAuth).not.toHaveBeenCalled()
  expect(hoisted.getOptionalAuth).not.toHaveBeenCalled()
}

describe('widget BFF requireWidgetAuth endpoints', () => {
  const required: { name: string; call: () => Promise<unknown>; run: () => unknown }[] = [
    {
      name: 'widgetCreatePublicPostFn',
      call: () => widgetCreatePublicPostFn({ data: { boardId: 'board_1', title: 'Idea' } }),
      run: () => hoisted.run.createPublicPost,
    },
    {
      name: 'widgetToggleVoteFn',
      call: () => widgetToggleVoteFn({ data: { postId: 'post_1' } }),
      run: () => hoisted.run.toggleVote,
    },
    {
      name: 'widgetCreateCommentFn',
      call: () => widgetCreateCommentFn({ data: { postId: 'post_1', content: 'Hi' } }),
      run: () => hoisted.run.createComment,
    },
    {
      name: 'widgetAddReactionFn',
      call: () => widgetAddReactionFn({ data: { commentId: 'cmt_1', emoji: '👍' } }),
      run: () => hoisted.run.addReaction,
    },
    {
      name: 'widgetRemoveReactionFn',
      call: () => widgetRemoveReactionFn({ data: { commentId: 'cmt_1', emoji: '👍' } }),
      run: () => hoisted.run.removeReaction,
    },
    {
      name: 'widgetSendConversationMessageFn',
      call: () => widgetSendConversationMessageFn({ data: { content: 'hello' } }),
      run: () => hoisted.run.sendConversationMessage,
    },
    {
      name: 'widgetListConversationMessagesFn',
      call: () => widgetListConversationMessagesFn({ data: { conversationId: 'conv_1' } }),
      run: () => hoisted.run.listConversationMessages,
    },
    {
      name: 'widgetMarkConversationReadFn',
      call: () => widgetMarkConversationReadFn({ data: { conversationId: 'conv_1' } }),
      run: () => hoisted.run.markConversationRead,
    },
    {
      name: 'widgetSendConversationTypingFn',
      call: () => widgetSendConversationTypingFn({ data: { conversationId: 'conv_1' } }),
      run: () => hoisted.run.sendConversationTyping,
    },
    {
      name: 'widgetSubmitCsatFn',
      call: () => widgetSubmitCsatFn({ data: { conversationId: 'conv_1', rating: 5 } }),
      run: () => hoisted.run.submitCsat,
    },
    {
      name: 'widgetMintConversationStreamTokenFn',
      call: () => widgetMintConversationStreamTokenFn(),
      run: () => hoisted.run.mintConversationStreamToken,
    },
    {
      name: 'widgetGetMyTicketsFn',
      call: () => widgetGetMyTicketsFn(),
      run: () => hoisted.run.getMyTickets,
    },
    {
      name: 'widgetGetMyTicketStageLabelsFn',
      call: () => widgetGetMyTicketStageLabelsFn(),
      run: () => hoisted.run.getMyTicketStageLabels,
    },
    {
      name: 'widgetGetMyTicketFormFn',
      call: () => widgetGetMyTicketFormFn(),
      run: () => hoisted.run.getMyTicketForm,
    },
    {
      name: 'widgetGetMyTicketWatchStatusFn',
      call: () => widgetGetMyTicketWatchStatusFn({ data: { ticketId: 'ticket_1' } }),
      run: () => hoisted.run.getMyTicketWatchStatus,
    },
    {
      name: 'widgetGetConversationLinkedTicketFn',
      call: () => widgetGetConversationLinkedTicketFn({ data: { conversationId: 'conv_1' } }),
      run: () => hoisted.run.getConversationLinkedTicket,
    },
    {
      name: 'widgetCreateMyTicketFn',
      call: () => widgetCreateMyTicketFn({ data: { title: 'Broken login' } }),
      run: () => hoisted.run.createMyTicket,
    },
    {
      name: 'widgetWatchMyTicketFn',
      call: () => widgetWatchMyTicketFn({ data: { ticketId: 'ticket_1' } }),
      run: () => hoisted.run.watchMyTicket,
    },
    {
      name: 'widgetUnwatchMyTicketFn',
      call: () => widgetUnwatchMyTicketFn({ data: { ticketId: 'ticket_1' } }),
      run: () => hoisted.run.unwatchMyTicket,
    },
    {
      name: 'widgetGetUserStatsFn',
      call: () => widgetGetUserStatsFn(),
      run: () => hoisted.run.getUserStats,
    },
  ]

  it.each(required)(
    '$name uses requireWidgetAuth and not site requireAuth',
    async ({ call, run }) => {
      await call()
      expect(hoisted.requireWidgetAuth).toHaveBeenCalled()
      expectWidgetAuthOnly()
      expect(run()).toHaveBeenCalled()
    }
  )

  it.each(required)('$name rejects without a widget session', async ({ call }) => {
    hoisted.requireWidgetAuth.mockRejectedValue(new Error('Authentication required'))
    await expect(call()).rejects.toThrow(/Authentication required/)
    expectWidgetAuthOnly()
  })
})

describe('widget BFF getOptionalWidgetAuth endpoints', () => {
  const optional: { name: string; call: () => Promise<unknown> }[] = [
    {
      name: 'widgetListPublicPostsFn',
      call: () => widgetListPublicPostsFn({ data: {} }),
    },
    {
      name: 'widgetGetVotedPostsFn',
      call: () => widgetGetVotedPostsFn(),
    },
    {
      name: 'widgetFetchPublicPostDetailFn',
      call: () => widgetFetchPublicPostDetailFn({ data: { postId: 'post_1' } }),
    },
    {
      name: 'widgetFetchBoardCapabilitiesFn',
      call: () => widgetFetchBoardCapabilitiesFn(),
    },
    {
      name: 'widgetGetMyConversationFn',
      call: () => widgetGetMyConversationFn({ data: {} }),
    },
    {
      name: 'widgetGetMyConversationsFn',
      call: () => widgetGetMyConversationsFn(),
    },
    {
      name: 'widgetGetMessengerUnreadFn',
      call: () => widgetGetMessengerUnreadFn(),
    },
    {
      name: 'widgetGetPublicChangelogFn',
      call: () => widgetGetPublicChangelogFn({ data: { id: 'changelog_1' } }),
    },
    {
      name: 'widgetListPublicChangelogsFn',
      call: () => widgetListPublicChangelogsFn({ data: {} }),
    },
    {
      name: 'widgetListPublicCategoriesFn',
      call: () => widgetListPublicCategoriesFn({ data: {} }),
    },
    {
      name: 'widgetListPublicArticlesForCategoryFn',
      call: () => widgetListPublicArticlesForCategoryFn({ data: { categoryId: 'cat_1' } }),
    },
    {
      name: 'widgetResolvePublicArticleRefFn',
      call: () => widgetResolvePublicArticleRefFn({ data: { ref: 'getting-started' } }),
    },
    {
      name: 'widgetRecordArticleFeedbackFn',
      call: () =>
        widgetRecordArticleFeedbackFn({ data: { articleId: 'kbarticle_1', helpful: true } }),
    },
    {
      name: 'widgetListPublicArticlesFn',
      call: () => widgetListPublicArticlesFn({ data: {} }),
    },
  ]

  it.each(optional)('$name uses getOptionalWidgetAuth and not site auth', async ({ call }) => {
    await call()
    expect(hoisted.getOptionalWidgetAuth).toHaveBeenCalled()
    expect(hoisted.requireWidgetAuth).not.toHaveBeenCalled()
    expectWidgetAuthOnly()
  })

  it.each(optional)('$name still runs when the widget session is absent', async ({ call }) => {
    hoisted.getOptionalWidgetAuth.mockResolvedValue(null)
    await expect(call()).resolves.toBeDefined()
    expectWidgetAuthOnly()
  })
})

describe('widget BFF unauthenticated workspace reads', () => {
  it('widgetGetConversationPresenceFn does not consult widget or site auth', async () => {
    await widgetGetConversationPresenceFn()
    expect(hoisted.requireWidgetAuth).not.toHaveBeenCalled()
    expect(hoisted.getOptionalWidgetAuth).not.toHaveBeenCalled()
    expectWidgetAuthOnly()
    expect(hoisted.run.getConversationPresence).toHaveBeenCalled()
  })

  it('widgetGetTeamAvatarsFn does not consult widget or site auth', async () => {
    await widgetGetTeamAvatarsFn()
    expect(hoisted.requireWidgetAuth).not.toHaveBeenCalled()
    expect(hoisted.getOptionalWidgetAuth).not.toHaveBeenCalled()
    expectWidgetAuthOnly()
    expect(hoisted.run.getWidgetTeamAvatars).toHaveBeenCalled()
  })
})
