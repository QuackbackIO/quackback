/**
 * Source-adapter seam for Quinn's grounding retrieval.
 *
 * `search_knowledge` used to call the knowledge base directly (the only
 * grounding source that existed). This module generalizes that into a
 * `KnowledgeSource` per grounding source — the knowledge base always,
 * feedback posts, admin-curated snippets, and the same customer's own
 * past-conversation summaries each behind their own flag — composed by
 * `retrieveKnowledge` into one ranked, budgeted result.
 *
 * The knowledge-base source is always registered; a source gated behind a
 * flag is registered only when that flag is on, via a lazy import so this
 * module never eagerly pulls in that source's domain.
 * With only the knowledge-base source registered (the flag-off default),
 * `retrieveKnowledge` is a byte-identical pass-through of
 * `retrieveKbArticles`'s own ranking — merging and re-ranking a single
 * source's already-sorted output changes nothing.
 */
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { ContentAudience } from './audience'
import { toHelpCenterAudience } from './audience'
import { retrieveKbArticles } from './retrieval'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import type { AssistantCitation } from './assistant.toolspec'
import type { AssistantCitationType } from './citation-types'

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
  sourceType: AssistantCitationType
  title: string
  excerpt: string
  score: number
  citation: AssistantCitation
  /**
   * ISO timestamp of the row's natural last update (article/post/snippet
   * updated_at, summary created_at), for the copilot citation freshness line
   * (CopilotCitation.updatedAt). Optional end-to-end: a source that doesn't
   * know simply omits it and no freshness line renders.
   */
  updatedAt?: string
}

/**
 * One grounding source Quinn can retrieve from. `sourceType` names the kind
 * of thing the source returns (mirrored on every item it produces).
 * `retrieve` takes the turn's retrieval ceiling (never a raw audience
 * string — see `./audience`) and returns already audience-scoped items; a
 * source is responsible for its own visibility predicate.
 *
 * `customerPrincipalId` and `conversationId` describe the CURRENT turn's
 * conversation (its customer, and the conversation itself), for a source
 * whose scope is per-customer rather than per-audience — today only the
 * past-conversation-summaries source (`conversation-summary-retrieval.ts`)
 * reads either; every other source ignores them. Both are undefined/null
 * when there is no real customer to scope to (e.g. the admin sandbox), which
 * a customer-scoped source MUST treat as "return nothing", never "return
 * everything" — a missing scope is not the same as an unbounded one.
 */
export interface KnowledgeSource {
  sourceType: RetrievedItem['sourceType']
  retrieve(
    query: string,
    ceiling: ContentAudience,
    opts: {
      topK: number
      signal?: AbortSignal
      customerPrincipalId?: PrincipalId
      conversationId?: ConversationId | null
    }
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
    // No viewer is threaded here, so at the 'public' ceiling retrieval fails
    // closed: articles under segment-gated categories are excluded entirely
    // (retrieveKbArticles defaults its viewer to ANONYMOUS_ACTOR). The 'team'
    // ceiling bypasses the gate and relies on the isPublic/internal flag for
    // the copilot leak gate.
    const articles = await retrieveKbArticles(query, { audience: toHelpCenterAudience(ceiling) })
    return articles.map((a) => ({
      id: a.id,
      sourceType: 'article' as const,
      title: a.title,
      excerpt: a.content.slice(0, KNOWLEDGE_SNIPPET_CHARS),
      score: a.score,
      updatedAt: a.updatedAt.toISOString(),
      citation: {
        type: 'article' as const,
        id: a.id,
        title: a.title,
        url: helpArticleUrl(a.categorySlug, a.slug),
        // Public at the 'public' ceiling is guaranteed by the audience filter
        // (isPublic is always true there); on 'team' it distinguishes a
        // team-only article, flagged for the copilot leak gate.
        ...(a.isPublic ? {} : { internal: true }),
      },
    }))
  },
}

const STATIC_SOURCES: readonly KnowledgeSource[] = [kbKnowledgeSource]

/**
 * Resolve the active source list: the knowledge-base source plus, behind the
 * `assistantKnowledge` flag, the feedback-posts source, the admin-curated
 * snippets source, the past-conversation-summaries source, the closed-tickets
 * source (team-only), and the changelog source. Each optional source's domain
 * is imported dynamically so this module (and everything that statically
 * imports it, including assistant.toolspec.ts) never pulls in that source's
 * schema at load time when the flag is off.
 */
export async function resolveKnowledgeSources(
  knowledgeEnabled?: boolean
): Promise<KnowledgeSource[]> {
  const sources: KnowledgeSource[] = [...STATIC_SOURCES]
  const includeAdditionalSources =
    knowledgeEnabled ?? (await isFeatureEnabled('assistantKnowledge'))
  if (includeAdditionalSources) {
    const [
      { postsKnowledgeSource },
      { snippetsKnowledgeSource },
      summaries,
      { ticketsKnowledgeSource },
      { changelogKnowledgeSource },
    ] = await Promise.all([
      import('./posts-retrieval'),
      import('./snippets-retrieval'),
      import('./conversation-summary-retrieval'),
      import('./tickets-retrieval'),
      import('./changelog-retrieval'),
    ])
    sources.push(
      postsKnowledgeSource,
      snippetsKnowledgeSource,
      summaries.conversationSummariesKnowledgeSource,
      ticketsKnowledgeSource,
      changelogKnowledgeSource
    )
  }
  return sources
}

/**
 * Compose every registered source for one query: run them in parallel, merge
 * by per-source rank, and trim to `topK`. This is the one thing
 * `search_knowledge` calls — it no longer knows the knowledge base is even a
 * source, let alone the only one.
 *
 * The merge is rank-based interleaving, NOT a sort on raw scores: score
 * scales are incommensurable across sources by construction (KB ts_rank
 * values sit well below 1 on the keyword fallback, cosine similarities span
 * ~0.35-0.9, and the ILIKE fallbacks have no relevance signal at all), so a
 * raw-score sort lets whichever source happens to use the largest scale crowd
 * every other source out of the budget whenever scales diverge — e.g. with
 * embeddings down, summaries used to bury KB articles entirely. A score IS
 * self-consistent within its own source, so each source's items are ranked by
 * their own score there; across sources, every source's #1 outranks any
 * source's #2 (and so on), with raw score only breaking ties WITHIN a rank
 * tier for a stable, continuity-preserving order. Rank interleaving is
 * structural — no per-source scale calibration exists to drift when a
 * source's scoring changes.
 *
 * A zero score is the one cross-source-comparable value: it means "no
 * relevance signal at all" (an ILIKE fallback hit), not "this source's own
 * scale of relevant". Zero-score rows therefore never compete in the rank
 * tiers — every scored row from every source seats first, then zero-score
 * rows append (in each source's own order) to fill whatever budget remains,
 * so a source degraded to its fallback can pad the result but never displace
 * another source's genuinely-scored items.
 *
 * `sourceTypes`, when given, is a per-request NARROWING filter applied after
 * `resolveKnowledgeSources()`: it can only drop sources the flags already
 * registered, never add one back that a flag left unregistered (the copilot
 * Answer-sources picker is the caller; it lets a teammate turn a source off
 * for one question, not turn on a source the workspace hasn't enabled).
 * `undefined` (the default) consults every registered source, unchanged.
 */
export async function retrieveKnowledge(
  query: string,
  ceiling: ContentAudience,
  opts: {
    topK?: number
    signal?: AbortSignal
    customerPrincipalId?: PrincipalId
    conversationId?: ConversationId | null
    sourceTypes?: RetrievedItem['sourceType'][]
    /** Turn-scoped feature snapshot; omitted only by legacy direct callers/tests. */
    knowledgeEnabled?: boolean
  } = {}
): Promise<RetrievedItem[]> {
  const topK = opts.topK ?? KNOWLEDGE_TOP_K
  const resolved = await resolveKnowledgeSources(opts.knowledgeEnabled)
  const sources = opts.sourceTypes
    ? resolved.filter((source) => opts.sourceTypes!.includes(source.sourceType))
    : resolved
  const perSource = await Promise.all(
    sources.map((source) =>
      source.retrieve(query, ceiling, {
        topK,
        signal: opts.signal,
        customerPrincipalId: opts.customerPrincipalId,
        conversationId: opts.conversationId,
      })
    )
  )
  // Rank within each source (its own scale is self-consistent), then
  // interleave rank tiers across sources, raw score breaking ties within a
  // tier — see the doc above for why raw scores never compete across sources.
  // Zero-score rows (no relevance signal — a source's ILIKE fallback) are
  // partitioned out of the tiers entirely and appended after every scored row,
  // in per-source rank order, so a degraded source only pads leftover budget.
  // A single registered source degenerates to its own ranking trimmed to
  // topK, exactly the flags-off pass-through this module has always promised.
  const ranked = perSource.map((items) => [...items].sort((a, b) => b.score - a.score))
  const scored = ranked.map((items) => items.filter((item) => item.score > 0))
  const unscored = ranked.flatMap((items) => items.filter((item) => item.score <= 0))
  const merged: RetrievedItem[] = []
  const deepestSource = Math.max(0, ...scored.map((items) => items.length))
  for (let rank = 0; rank < deepestSource && merged.length < topK; rank++) {
    const tier = scored
      .map((items) => items[rank])
      .filter((item): item is RetrievedItem => item !== undefined)
      .sort((a, b) => b.score - a.score)
    merged.push(...tier)
  }
  merged.push(...unscored)
  return merged.slice(0, topK)
}
