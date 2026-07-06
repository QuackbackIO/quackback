/**
 * Source-adapter seam for Quinn's grounding retrieval.
 *
 * `search_knowledge` used to call the knowledge base directly (the only
 * grounding source that existed). This module generalizes that into a
 * `KnowledgeSource` per grounding source — the knowledge base always,
 * feedback posts and admin-curated snippets each behind their own flag, more
 * later (past-conversation summaries) — composed by `retrieveKnowledge` into
 * one ranked, budgeted result.
 *
 * Mirrors the static-plus-flagged-dynamic shape of `resolveToolSpecs()`
 * (assistant.toolspec.ts): the knowledge-base source is always registered; a
 * source gated behind a flag is registered only when that flag is on, via a
 * lazy import so this module never eagerly pulls in that source's domain.
 * With only the knowledge-base source registered (the flag-off default),
 * `retrieveKnowledge` is a byte-identical pass-through of
 * `retrieveKbArticles`'s own ranking — merging and re-ranking a single
 * source's already-sorted output changes nothing.
 */
import type { ContentAudience } from './audience'
import { toHelpCenterAudience } from './audience'
import { retrieveKbArticles } from './retrieval'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import type { AssistantCitation } from './assistant.toolspec'

/** Per-item snippet budget handed to the model (full content stays server-side). */
export const KNOWLEDGE_SNIPPET_CHARS = 1200

/** Default number of merged items handed to the model per search_knowledge call. */
export const KNOWLEDGE_TOP_K = 5

/**
 * One retrieved grounding candidate, source-agnostic past this point. Every
 * `KnowledgeSource` maps its own row shape onto this before it reaches the
 * composer, so `retrieveKnowledge` never needs to know what kind of thing it
 * merged and ranked.
 */
export interface RetrievedItem {
  id: string
  sourceType: 'article' | 'post' | 'snippet'
  title: string
  excerpt: string
  score: number
  citation: AssistantCitation
}

/**
 * One grounding source Quinn can retrieve from. `sourceType` names the kind
 * of thing the source returns (mirrored on every item it produces).
 * `retrieve` takes the turn's retrieval ceiling (never a raw audience
 * string — see `./audience`) and returns already audience-scoped items; a
 * source is responsible for its own visibility predicate.
 */
export interface KnowledgeSource {
  sourceType: RetrievedItem['sourceType']
  retrieve(
    query: string,
    ceiling: ContentAudience,
    opts: { topK: number; signal?: AbortSignal }
  ): Promise<RetrievedItem[]>
}

/** Public help-center path for a retrieved article. */
function helpArticleUrl(categorySlug: string, slug: string): string {
  return `/hc/articles/${categorySlug}/${slug}`
}

/**
 * The knowledge-base source: wraps `retrieveKbArticles` unchanged (its
 * signature is untouched — this only maps its rows onto `RetrievedItem`),
 * translating the turn's `ContentAudience` ceiling to the narrower
 * `HelpCenterAudience` at this one boundary. Always registered: the
 * knowledge base is the grounding source every deploy has from day one, so
 * unlike a future source it never needs a flag check to be included.
 *
 * Deliberately ignores `opts.topK`: `retrieveKbArticles` already applies its
 * own default top-k, and forwarding a different value here would change the
 * exact call shape callers and tests pin today. The composer trims the
 * merged result to the overall topK afterward, so this doesn't under-serve
 * the budget.
 */
export const kbKnowledgeSource: KnowledgeSource = {
  sourceType: 'article',
  async retrieve(query, ceiling) {
    const articles = await retrieveKbArticles(query, { audience: toHelpCenterAudience(ceiling) })
    return articles.map((a) => ({
      id: a.id,
      sourceType: 'article' as const,
      title: a.title,
      excerpt: a.content.slice(0, KNOWLEDGE_SNIPPET_CHARS),
      score: a.score,
      citation: {
        type: 'article' as const,
        id: a.id,
        title: a.title,
        url: helpArticleUrl(a.categorySlug, a.slug),
      },
    }))
  },
}

const STATIC_SOURCES: readonly KnowledgeSource[] = [kbKnowledgeSource]

/**
 * Resolve the active source list: the knowledge-base source plus, per-flag,
 * the feedback-posts source (`assistantPostGrounding`) and the admin-curated
 * snippets source (`assistantSnippets`). Each optional source's domain is
 * imported dynamically so this module (and everything that statically
 * imports it, including assistant.toolspec.ts) never pulls in that source's
 * schema at load time when its flag is off — mirrors `resolveToolSpecs()`'s
 * lazy import of the connectors domain behind `dataConnectors`.
 */
export async function resolveKnowledgeSources(): Promise<KnowledgeSource[]> {
  const [postGroundingEnabled, snippetsEnabled] = await Promise.all([
    isFeatureEnabled('assistantPostGrounding'),
    isFeatureEnabled('assistantSnippets'),
  ])
  const sources: KnowledgeSource[] = [...STATIC_SOURCES]
  if (postGroundingEnabled) {
    const { postsKnowledgeSource } = await import('./posts-retrieval')
    sources.push(postsKnowledgeSource)
  }
  if (snippetsEnabled) {
    const { snippetsKnowledgeSource } = await import('./snippets-retrieval')
    sources.push(snippetsKnowledgeSource)
  }
  return sources
}

/**
 * Compose every registered source for one query: run them in parallel, merge,
 * re-rank by score desc, and trim to `topK`. This is the one thing
 * `search_knowledge` calls — it no longer knows the knowledge base is even a
 * source, let alone the only one.
 */
export async function retrieveKnowledge(
  query: string,
  ceiling: ContentAudience,
  opts: { topK?: number; signal?: AbortSignal } = {}
): Promise<RetrievedItem[]> {
  const topK = opts.topK ?? KNOWLEDGE_TOP_K
  const sources = await resolveKnowledgeSources()
  const perSource = await Promise.all(
    sources.map((source) => source.retrieve(query, ceiling, { topK, signal: opts.signal }))
  )
  return perSource
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
