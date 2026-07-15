import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeKbArticle } from './kb-fixtures'
import { ASSISTANT_CITATION_TYPES, type AssistantCitationType } from '../citation-types'

const mockRetrieveKbArticles = vi.fn()
vi.mock('../retrieval', () => ({
  retrieveKbArticles: (...args: unknown[]) => mockRetrieveKbArticles(...args),
}))

// Stands in for the real feedback-posts source: resolveKnowledgeSources
// dynamically imports './posts-retrieval' only when 'post' is in the turn's
// enabled-source set (config v3).
const mockPostsRetrieve = vi.fn()
vi.mock('../posts-retrieval', () => ({
  postsKnowledgeSource: {
    sourceType: 'post',
    retrieve: (...args: unknown[]) => mockPostsRetrieve(...args),
  },
}))

// Same idea for the snippets source.
const mockSnippetsRetrieve = vi.fn()
vi.mock('../snippets-retrieval', () => ({
  snippetsKnowledgeSource: {
    sourceType: 'snippet',
    retrieve: (...args: unknown[]) => mockSnippetsRetrieve(...args),
  },
}))

// Same idea for the past-conversation-summaries source.
const mockConversationSummariesRetrieve = vi.fn()
vi.mock('../conversation-summary-retrieval', () => ({
  conversationSummariesKnowledgeSource: {
    sourceType: 'summary',
    retrieve: (...args: unknown[]) => mockConversationSummariesRetrieve(...args),
  },
}))

// Same idea for the closed-tickets source (team-only).
const mockTicketsRetrieve = vi.fn()
vi.mock('../tickets-retrieval', () => ({
  ticketsKnowledgeSource: {
    sourceType: 'ticket',
    retrieve: (...args: unknown[]) => mockTicketsRetrieve(...args),
  },
}))

// Same idea for the changelog source.
const mockChangelogRetrieve = vi.fn()
vi.mock('../changelog-retrieval', () => ({
  changelogKnowledgeSource: {
    sourceType: 'changelog',
    retrieve: (...args: unknown[]) => mockChangelogRetrieve(...args),
  },
}))

import {
  retrieveKnowledge,
  resolveKnowledgeSources,
  resolveAssistantKnowledgeSnapshot,
  describeEnabledKnowledgeSources,
  kbKnowledgeSource,
  KNOWLEDGE_SNIPPET_CHARS,
} from '../retrieval-sources'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'

/** Every retrieval source enabled — the config-v3 snapshot standing in for the
 *  old flag-on bundle. */
const ALL_SOURCES: ReadonlySet<AssistantCitationType> = new Set(ASSISTANT_CITATION_TYPES)

beforeEach(() => {
  vi.clearAllMocks()
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

describe('resolveAssistantKnowledgeSnapshot', () => {
  it('compiles the Agent map (public ceiling): helpCenter only, no snippets, no team-only sources', () => {
    const snap = resolveAssistantKnowledgeSnapshot('agent', DEFAULT_ASSISTANT_CONFIG, 'public')
    expect([...snap.sources].sort()).toEqual(['article'])
    expect(snap.status).toBe(false)
  })

  it('respects the Agent posts + changelog + status toggles', () => {
    const config = structuredClone(DEFAULT_ASSISTANT_CONFIG)
    config.agents.agent.knowledge = {
      helpCenter: true,
      posts: true,
      changelog: true,
      status: true,
    }
    const snap = resolveAssistantKnowledgeSnapshot('agent', config, 'public')
    expect([...snap.sources].sort()).toEqual(['article', 'changelog', 'post'])
    expect(snap.status).toBe(true)
    // Snippets are never on a public turn.
    expect(snap.sources.has('snippet')).toBe(false)
  })

  it('compiles the Copilot map (team ceiling): its enabled sources plus always-on snippets', () => {
    const snap = resolveAssistantKnowledgeSnapshot('copilot', DEFAULT_ASSISTANT_CONFIG, 'team')
    // Default copilot: helpCenter, posts, pastConversations on; tickets,
    // changelog off; plus snippets always at the team ceiling; status on.
    expect([...snap.sources].sort()).toEqual(['article', 'post', 'snippet', 'summary'])
    expect(snap.status).toBe(true)
  })

  it('a Copilot with every source off still gets snippets at the team ceiling', () => {
    const config = structuredClone(DEFAULT_ASSISTANT_CONFIG)
    config.agents.copilot.knowledge = {
      helpCenter: false,
      posts: false,
      pastConversations: false,
      internalNotes: false,
      tickets: false,
      changelog: false,
      status: false,
    }
    const snap = resolveAssistantKnowledgeSnapshot('copilot', config, 'team')
    expect([...snap.sources]).toEqual(['snippet'])
    expect(snap.status).toBe(false)
  })
})

describe('describeEnabledKnowledgeSources', () => {
  it('enumerates enabled sources in citation-vocabulary order', () => {
    const text = describeEnabledKnowledgeSources(new Set(['article', 'changelog']))
    expect(text).toContain('help center articles')
    expect(text).toContain('changelog entries')
    expect(text).toContain('sources parameter')
  })

  it('adds the customer-feedback caveat when posts are enabled', () => {
    const text = describeEnabledKnowledgeSources(new Set(['article', 'post']))
    expect(text).toMatch(/customer feedback, not/i)
  })

  it('is empty when no source is enabled', () => {
    expect(describeEnabledKnowledgeSources(new Set())).toBe('')
  })
})

describe('resolveKnowledgeSources', () => {
  it('defaults to only the knowledge-base source when no snapshot is passed', async () => {
    const sources = await resolveKnowledgeSources()
    expect(sources).toEqual([kbKnowledgeSource])
  })

  it('registers exactly the sources named in the enabled set, in vocabulary order', async () => {
    const sources = await resolveKnowledgeSources(ALL_SOURCES)
    expect(sources.map((s) => s.sourceType)).toEqual([
      'article',
      'post',
      'snippet',
      'summary',
      'ticket',
      'changelog',
    ])
  })

  it('omits a source whose type is not enabled', async () => {
    const sources = await resolveKnowledgeSources(new Set(['article', 'changelog']))
    expect(sources.map((s) => s.sourceType)).toEqual(['article', 'changelog'])
  })
})

describe('retrieveKnowledge', () => {
  it('consults only the knowledge base when no enabled set is passed (KB-only default)', async () => {
    mockRetrieveKbArticles.mockResolvedValue([makeKbArticle('kb_article_1', { score: 0.9 })])

    const items = await retrieveKnowledge('q', 'public')

    expect(items).toHaveLength(1)
    expect(items[0].sourceType).toBe('article')
    expect(mockPostsRetrieve).not.toHaveBeenCalled()
  })

  it('merges sources in parallel by rank tier (score breaking ties within a tier) and trims to topK', async () => {
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

    const items = await retrieveKnowledge('q', 'public', { topK: 3, enabledSources: ALL_SOURCES })

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

    const items = await retrieveKnowledge('q', 'public', { topK: 5, enabledSources: ALL_SOURCES })

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

    const items = await retrieveKnowledge('q', 'public', { topK: 5, enabledSources: ALL_SOURCES })

    expect(items.map((i) => i.id)).toEqual([
      'kb_best',
      'kb_second',
      'kb_third',
      'conversation_a',
      'conversation_b',
    ])
  })

  it('sourceTypes undefined consults every registered source (default, unchanged)', async () => {
    mockRetrieveKbArticles.mockResolvedValue([makeKbArticle('kb_article_1', { score: 0.5 })])
    mockPostsRetrieve.mockResolvedValue([])
    mockSnippetsRetrieve.mockResolvedValue([])
    mockConversationSummariesRetrieve.mockResolvedValue([])

    await retrieveKnowledge('q', 'public', { enabledSources: ALL_SOURCES })

    expect(mockRetrieveKbArticles).toHaveBeenCalled()
    expect(mockPostsRetrieve).toHaveBeenCalled()
    expect(mockSnippetsRetrieve).toHaveBeenCalled()
    expect(mockConversationSummariesRetrieve).toHaveBeenCalled()
    expect(mockTicketsRetrieve).toHaveBeenCalled()
    expect(mockChangelogRetrieve).toHaveBeenCalled()
  })

  it('sourceTypes narrows to the given subset, skipping every other registered source', async () => {
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

    const items = await retrieveKnowledge('q', 'public', {
      enabledSources: ALL_SOURCES,
      sourceTypes: ['snippet'],
    })

    expect(mockRetrieveKbArticles).not.toHaveBeenCalled()
    expect(mockPostsRetrieve).not.toHaveBeenCalled()
    expect(mockConversationSummariesRetrieve).not.toHaveBeenCalled()
    expect(mockSnippetsRetrieve).toHaveBeenCalled()
    expect(items.map((i) => i.id)).toEqual(['assistant_snippet_1'])
  })

  it('cannot re-enable an unregistered source: sourceTypes only narrows what the snapshot already registered', async () => {
    // Only the knowledge base is enabled, even though the request asks for
    // posts too — narrowing can drop, never add.
    mockRetrieveKbArticles.mockResolvedValue([makeKbArticle('kb_article_1', { score: 0.5 })])

    const items = await retrieveKnowledge('q', 'public', {
      enabledSources: new Set(['article']),
      sourceTypes: ['article', 'post'],
    })

    expect(mockPostsRetrieve).not.toHaveBeenCalled()
    expect(items.map((i) => i.id)).toEqual(['kb_article_1'])
  })

  it('forwards customerPrincipalId and conversationId to every source (only the summaries source reads them)', async () => {
    mockRetrieveKbArticles.mockResolvedValue([])
    mockPostsRetrieve.mockResolvedValue([])
    mockSnippetsRetrieve.mockResolvedValue([])
    mockConversationSummariesRetrieve.mockResolvedValue([])

    await retrieveKnowledge('q', 'public', {
      enabledSources: ALL_SOURCES,
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
