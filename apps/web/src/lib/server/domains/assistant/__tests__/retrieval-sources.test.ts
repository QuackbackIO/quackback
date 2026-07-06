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
// dynamically imports './posts-retrieval' only when assistantPostGrounding is
// on, mirroring resolveToolSpecs's lazy import of the connectors domain
// behind dataConnectors (see assistant.tools.test.ts / assistant.runtime.test.ts).
const mockPostsRetrieve = vi.fn()
vi.mock('../posts-retrieval', () => ({
  postsKnowledgeSource: {
    sourceType: 'post',
    retrieve: (...args: unknown[]) => mockPostsRetrieve(...args),
  },
}))

// Same idea for the snippets source, gated behind assistantSnippets.
const mockSnippetsRetrieve = vi.fn()
vi.mock('../snippets-retrieval', () => ({
  snippetsKnowledgeSource: {
    sourceType: 'snippet',
    retrieve: (...args: unknown[]) => mockSnippetsRetrieve(...args),
  },
}))

/** Flag-aware stand-in for isFeatureEnabled, so enabling one grounding flag
 *  in a test doesn't accidentally also enable the other. */
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
})

describe('resolveKnowledgeSources', () => {
  it('registers only the knowledge-base source when both flags are off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const sources = await resolveKnowledgeSources()
    expect(sources).toEqual([kbKnowledgeSource])
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('assistantPostGrounding')
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('assistantSnippets')
  })

  it('adds the feedback-posts source when assistantPostGrounding is on', async () => {
    mockIsFeatureEnabled.mockImplementation(onlyFlag('assistantPostGrounding'))
    const sources = await resolveKnowledgeSources()
    expect(sources.map((s) => s.sourceType)).toEqual(['article', 'post'])
  })

  it('adds the snippets source when assistantSnippets is on', async () => {
    mockIsFeatureEnabled.mockImplementation(onlyFlag('assistantSnippets'))
    const sources = await resolveKnowledgeSources()
    expect(sources.map((s) => s.sourceType)).toEqual(['article', 'snippet'])
  })

  it('adds both optional sources when both flags are on', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)
    const sources = await resolveKnowledgeSources()
    expect(sources.map((s) => s.sourceType)).toEqual(['article', 'post', 'snippet'])
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

  it('merges sources in parallel, re-ranks by score desc, and trims to topK', async () => {
    mockIsFeatureEnabled.mockImplementation(onlyFlag('assistantPostGrounding'))
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

    // Both sources ran (parallel composition); result is trimmed to topK and
    // ordered by score desc across sources, dropping the lowest overall score
    // (kb_low, 0.5) even though it came from the always-on source.
    expect(mockRetrieveKbArticles).toHaveBeenCalledOnce()
    expect(mockPostsRetrieve).toHaveBeenCalledOnce()
    expect(items.map((i) => i.id)).toEqual(['post_top', 'kb_high', 'post_mid'])
    expect(items).toHaveLength(3)
  })
})
