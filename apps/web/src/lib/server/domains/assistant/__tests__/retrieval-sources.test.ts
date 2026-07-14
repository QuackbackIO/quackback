import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeKbArticle } from './kb-fixtures'

const mockRetrieveKbArticles = vi.fn()
vi.mock('../retrieval', () => ({
  retrieveKbArticles: (...args: unknown[]) => mockRetrieveKbArticles(...args),
}))

const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))

// Stands in for the real feedback-posts source: resolveKnowledgeSources
// dynamically imports './posts-retrieval' only when assistantKnowledge is on.
const mockPostsRetrieve = vi.fn()
vi.mock('../posts-retrieval', () => ({
  postsKnowledgeSource: {
    sourceType: 'post',
    retrieve: (...args: unknown[]) => mockPostsRetrieve(...args),
  },
}))

// Same idea for the snippets source, behind the same flag.
const mockSnippetsRetrieve = vi.fn()
vi.mock('../snippets-retrieval', () => ({
  snippetsKnowledgeSource: {
    sourceType: 'snippet',
    retrieve: (...args: unknown[]) => mockSnippetsRetrieve(...args),
  },
}))

// Same idea for the past-conversation-summaries source, behind the same flag.
const mockConversationSummariesRetrieve = vi.fn()
vi.mock('../conversation-summary-retrieval', () => ({
  conversationSummariesKnowledgeSource: {
    sourceType: 'summary',
    retrieve: (...args: unknown[]) => mockConversationSummariesRetrieve(...args),
  },
}))

// Same idea for the closed-tickets source (team-only), behind the same flag.
const mockTicketsRetrieve = vi.fn()
vi.mock('../tickets-retrieval', () => ({
  ticketsKnowledgeSource: {
    sourceType: 'ticket',
    retrieve: (...args: unknown[]) => mockTicketsRetrieve(...args),
  },
}))

// Same idea for the changelog source, behind the same flag.
const mockChangelogRetrieve = vi.fn()
vi.mock('../changelog-retrieval', () => ({
  changelogKnowledgeSource: {
    sourceType: 'changelog',
    retrieve: (...args: unknown[]) => mockChangelogRetrieve(...args),
  },
}))

/** Flag-aware stand-in for isFeatureEnabled, so enabling one flag in a test
 *  doesn't accidentally also enable another. */
function onlyFlag(enabledFlag: string) {
  return async (flag: string) => flag === enabledFlag
}

import {
  retrieveKnowledge,
  resolveKnowledgeSources,
  kbKnowledgeSource,
  KNOWLEDGE_SNIPPET_CHARS,
} from '../retrieval-sources'

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFeatureEnabled.mockResolvedValue(false)
  // The team-only tickets source and the changelog source default to empty so
  // existing merge/forwarding assertions (which don't seed them) stay valid;
  // a test that cares seeds its own rows.
  mockTicketsRetrieve.mockResolvedValue([])
  mockChangelogRetrieve.mockResolvedValue([])
})

describe('kbKnowledgeSource', () => {
  it('maps a retrieved article onto a RetrievedItem with an article citation', async () => {
    mockRetrieveKbArticles.mockResolvedValue([
      makeKbArticle('kb_article_1', { content: 'X'.repeat(5000), score: 0.87 }),
    ])

    const items = await kbKnowledgeSource.retrieve('reset password', 'public', {
      topK: 5,
    })

    expect(mockRetrieveKbArticles).toHaveBeenCalledWith('reset password', { audience: 'public' })
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({
      id: 'kb_article_1',
      sourceType: 'article',
      title: 'Title kb_article_1',
      excerpt: 'X'.repeat(KNOWLEDGE_SNIPPET_CHARS),
      score: 0.87,
      // The row's own updated_at, ISO-encoded for the copilot freshness line —
      // on the item here; the runtime copies it onto the ledgered citation for
      // EVERY surface, and the orchestrator's persistence point strips it.
      updatedAt: '2026-06-01T00:00:00.000Z',
      citation: {
        type: 'article',
        id: 'kb_article_1',
        title: 'Title kb_article_1',
        url: '/hc/articles/general/slug-kb_article_1',
      },
    })
  })

  it('maps the team ceiling to the team HelpCenterAudience', async () => {
    mockRetrieveKbArticles.mockResolvedValue([])
    await kbKnowledgeSource.retrieve('escalation policy', 'team', { topK: 5 })
    expect(mockRetrieveKbArticles).toHaveBeenCalledWith('escalation policy', { audience: 'team' })
  })

  it('maps the internal ceiling to the team HelpCenterAudience (no internal KB tier)', async () => {
    mockRetrieveKbArticles.mockResolvedValue([])
    await kbKnowledgeSource.retrieve('q', 'internal', { topK: 5 })
    expect(mockRetrieveKbArticles).toHaveBeenCalledWith('q', { audience: 'team' })
  })

  it('flags a team-only article as internal (isPublic: false)', async () => {
    mockRetrieveKbArticles.mockResolvedValue([
      makeKbArticle('kb_article_private', { isPublic: false }),
    ])
    const items = await kbKnowledgeSource.retrieve('policy', 'team', { topK: 5 })
    expect(items[0].citation.internal).toBe(true)
  })

  it('leaves a public article unflagged (no internal key)', async () => {
    mockRetrieveKbArticles.mockResolvedValue([
      makeKbArticle('kb_article_public', { isPublic: true }),
    ])
    const items = await kbKnowledgeSource.retrieve('policy', 'public', { topK: 5 })
    expect(items[0].citation).not.toHaveProperty('internal')
  })
})

describe('resolveKnowledgeSources', () => {
  it('registers only the knowledge-base source when assistantKnowledge is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const sources = await resolveKnowledgeSources()
    expect(sources).toEqual([kbKnowledgeSource])
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('assistantKnowledge')
  })

  it('adds the posts, snippets, summaries, tickets, and changelog sources when assistantKnowledge is on', async () => {
    mockIsFeatureEnabled.mockImplementation(onlyFlag('assistantKnowledge'))
    const sources = await resolveKnowledgeSources()
    expect(sources.map((s) => s.sourceType)).toEqual([
      'article',
      'post',
      'snippet',
      'summary',
      'ticket',
      'changelog',
    ])
  })
})

describe('retrieveKnowledge', () => {
  it('consults only the knowledge base when the flag is off (flags-off regression)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockRetrieveKbArticles.mockResolvedValue([makeKbArticle('kb_article_1', { score: 0.9 })])

    const items = await retrieveKnowledge('q', 'public')

    expect(items).toHaveLength(1)
    expect(items[0].sourceType).toBe('article')
    expect(mockPostsRetrieve).not.toHaveBeenCalled()
  })

  it('merges sources in parallel by rank tier (score breaking ties within a tier) and trims to topK', async () => {
    mockIsFeatureEnabled.mockImplementation(onlyFlag('assistantKnowledge'))
    mockSnippetsRetrieve.mockResolvedValue([])
    mockConversationSummariesRetrieve.mockResolvedValue([])
    mockRetrieveKbArticles.mockResolvedValue([
      makeKbArticle('kb_low', { score: 0.5 }),
      makeKbArticle('kb_high', { score: 0.9 }),
    ])
    mockPostsRetrieve.mockResolvedValue([
      {
        id: 'post_mid',
        sourceType: 'post',
        title: 'Post mid',
        excerpt: 'mid',
        score: 0.7,
        citation: {
          type: 'post',
          id: 'post_mid',
          title: 'Post mid',
          url: '/b/general/posts/post_mid',
        },
      },
      {
        id: 'post_top',
        sourceType: 'post',
        title: 'Post top',
        excerpt: 'top',
        score: 0.95,
        citation: {
          type: 'post',
          id: 'post_top',
          title: 'Post top',
          url: '/b/general/posts/post_top',
        },
      },
    ])

    const items = await retrieveKnowledge('q', 'public', { topK: 3 })

    // Both sources ran (parallel composition); the merge interleaves rank
    // tiers (each source's #1 before any source's #2, raw score ordering
    // within a tier) and trims to topK, dropping the last-tier loser
    // (kb_low, 0.5) even though it came from the always-on source.
    expect(mockRetrieveKbArticles).toHaveBeenCalledOnce()
    expect(mockPostsRetrieve).toHaveBeenCalledOnce()
    expect(items.map((i) => i.id)).toEqual(['post_top', 'kb_high', 'post_mid'])
    expect(items).toHaveLength(3)
  })

  it('a source scoring on a larger scale cannot crowd the others out of the budget (rank interleaving)', async () => {
    // The embeddings-down failure this pins: the summaries keyword fallback
    // used to hardcode score 1.0 while KB ts_rank sits well below 1, so a
    // raw-score merge filled the whole topK with summaries and buried every
    // KB article. Rank interleaving guarantees each source's best items a
    // seat regardless of its scale.
    mockIsFeatureEnabled.mockImplementation(onlyFlag('assistantKnowledge'))
    mockPostsRetrieve.mockResolvedValue([])
    mockSnippetsRetrieve.mockResolvedValue([])
    mockRetrieveKbArticles.mockResolvedValue([
      makeKbArticle('kb_best', { score: 0.08 }),
      makeKbArticle('kb_second', { score: 0.05 }),
      makeKbArticle('kb_third', { score: 0.03 }),
    ])
    const summary = (id: string, score: number) => ({
      id,
      sourceType: 'summary' as const,
      title: 'Past conversation',
      excerpt: 'x',
      score,
      citation: { type: 'summary' as const, id, title: 'Past conversation', url: '' },
    })
    mockConversationSummariesRetrieve.mockResolvedValue([
      summary('conversation_a', 1),
      summary('conversation_b', 1),
      summary('conversation_c', 1),
      summary('conversation_d', 1),
      summary('conversation_e', 1),
    ])

    const items = await retrieveKnowledge('q', 'public', { topK: 5 })

    // Tier by tier: each source's #1 first (summary wins its tier on raw
    // score), then each #2, then each #3 — the KB survives into the budget
    // instead of losing every slot to the flat 1.0 scale.
    expect(items.map((i) => i.id)).toEqual([
      'conversation_a',
      'kb_best',
      'conversation_b',
      'kb_second',
      'conversation_c',
    ])
  })

  it('zero-score fallback rows seat after every scored row (embeddings-down: KB keyword hits fill topK first)', async () => {
    // The embeddings-down shape after the summaries fallback stopped
    // hardcoding 1.0: the summaries ILIKE fallback has no relevance signal
    // (score 0), while the KB keyword path still produces real ts_rank
    // scores. Zero-score rows must not compete in the rank tiers at all —
    // every scored KB row seats first, then the zero-score summaries pad the
    // remaining budget in their own per-source order.
    mockIsFeatureEnabled.mockImplementation(onlyFlag('assistantKnowledge'))
    mockPostsRetrieve.mockResolvedValue([])
    mockSnippetsRetrieve.mockResolvedValue([])
    mockRetrieveKbArticles.mockResolvedValue([
      makeKbArticle('kb_best', { score: 0.08 }),
      makeKbArticle('kb_second', { score: 0.05 }),
      makeKbArticle('kb_third', { score: 0.03 }),
    ])
    const summary = (id: string, score: number) => ({
      id,
      sourceType: 'summary' as const,
      title: 'Past conversation',
      excerpt: 'x',
      score,
      citation: { type: 'summary' as const, id, title: 'Past conversation', url: '' },
    })
    mockConversationSummariesRetrieve.mockResolvedValue([
      summary('conversation_a', 0),
      summary('conversation_b', 0),
      summary('conversation_c', 0),
      summary('conversation_d', 0),
      summary('conversation_e', 0),
    ])

    const items = await retrieveKnowledge('q', 'public', { topK: 5 })

    expect(items.map((i) => i.id)).toEqual([
      'kb_best',
      'kb_second',
      'kb_third',
      'conversation_a',
      'conversation_b',
    ])
  })

  it('sourceTypes undefined consults every registered source (default, unchanged)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockRetrieveKbArticles.mockResolvedValue([makeKbArticle('kb_article_1', { score: 0.5 })])
    mockPostsRetrieve.mockResolvedValue([])
    mockSnippetsRetrieve.mockResolvedValue([])
    mockConversationSummariesRetrieve.mockResolvedValue([])

    await retrieveKnowledge('q', 'public')

    expect(mockRetrieveKbArticles).toHaveBeenCalled()
    expect(mockPostsRetrieve).toHaveBeenCalled()
    expect(mockSnippetsRetrieve).toHaveBeenCalled()
    expect(mockConversationSummariesRetrieve).toHaveBeenCalled()
    expect(mockTicketsRetrieve).toHaveBeenCalled()
    expect(mockChangelogRetrieve).toHaveBeenCalled()
  })

  it('sourceTypes narrows to the given subset, skipping every other registered source', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockRetrieveKbArticles.mockResolvedValue([makeKbArticle('kb_article_1', { score: 0.5 })])
    mockSnippetsRetrieve.mockResolvedValue([
      {
        id: 'assistant_snippet_1',
        sourceType: 'snippet',
        title: 'Snippet',
        excerpt: 'x',
        score: 0.9,
        citation: { type: 'snippet', id: 'assistant_snippet_1', title: 'Snippet', url: '' },
      },
    ])

    const items = await retrieveKnowledge('q', 'public', { sourceTypes: ['snippet'] })

    expect(mockRetrieveKbArticles).not.toHaveBeenCalled()
    expect(mockPostsRetrieve).not.toHaveBeenCalled()
    expect(mockConversationSummariesRetrieve).not.toHaveBeenCalled()
    expect(mockSnippetsRetrieve).toHaveBeenCalled()
    expect(items.map((i) => i.id)).toEqual(['assistant_snippet_1'])
  })

  it('cannot re-enable a flag-off source: sourceTypes only narrows what resolveKnowledgeSources already registered', async () => {
    // Every optional flag off: only the knowledge base is registered, even
    // though the request asks for posts too.
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockRetrieveKbArticles.mockResolvedValue([makeKbArticle('kb_article_1', { score: 0.5 })])

    const items = await retrieveKnowledge('q', 'public', { sourceTypes: ['article', 'post'] })

    expect(mockPostsRetrieve).not.toHaveBeenCalled()
    expect(items.map((i) => i.id)).toEqual(['kb_article_1'])
  })

  it('forwards customerPrincipalId and conversationId to every source (only the summaries source reads them)', async () => {
    mockIsFeatureEnabled.mockImplementation(onlyFlag('assistantKnowledge'))
    mockRetrieveKbArticles.mockResolvedValue([])
    mockPostsRetrieve.mockResolvedValue([])
    mockSnippetsRetrieve.mockResolvedValue([])
    mockConversationSummariesRetrieve.mockResolvedValue([])

    await retrieveKnowledge('q', 'public', {
      customerPrincipalId: 'principal_customer_1' as never,
      conversationId: 'conversation_current' as never,
    })

    expect(mockConversationSummariesRetrieve).toHaveBeenCalledWith(
      'q',
      'public',
      expect.objectContaining({
        customerPrincipalId: 'principal_customer_1',
        conversationId: 'conversation_current',
      })
    )
  })
})
