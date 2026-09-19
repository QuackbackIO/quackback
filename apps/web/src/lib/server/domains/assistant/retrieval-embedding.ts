/**
 * One query embedding per turn, shared across every adapter that wants one.
 *
 * Before this, a single `search` call embedded the same question once per
 * source adapter: the knowledge base, documents, posts, the changelog, snippets,
 * tickets and past summaries each made their own provider round trip for a
 * byte-identical string. They all read the same embedding space, so the vector
 * is computed once here and passed down.
 *
 * It is passed rather than cached. A module-level cache would make an adapter's
 * behaviour depend on what some earlier turn asked, which is exactly the kind of
 * hidden coupling that makes a retrieval regression impossible to reproduce; an
 * explicit argument is also what lets an adapter still be called on its own.
 *
 * `null` is a first-class answer and means "no vector arm this turn": no
 * embedding model is configured, the provider failed, or it returned a vector of
 * the wrong width. Every adapter already has a lexical arm, so the turn degrades
 * rather than failing, and `degradedReason` is what makes that visible instead
 * of looking like a corpus with nothing relevant in it.
 */
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { getEmbeddingModel } from '@/lib/server/domains/ai/models'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-retrieval-embedding' })

/** The width every embedding column in this schema is declared at. */
export const RETRIEVAL_EMBEDDING_DIMENSIONS = 1536

export interface QueryEmbedding {
  /** Which space this vector lives in. Compared against a generation's own model. */
  model: string
  dimensions: number
  vector: number[]
}

export type RetrievalDegradedReason =
  'embeddings_unconfigured' | 'embedding_failed' | 'embedding_dimension_mismatch'

export interface QueryEmbeddingResult {
  embedding: QueryEmbedding | null
  degradedReason: RetrievalDegradedReason | null
}

/**
 * Resolve the turn's query embedding once.
 *
 * A dimension that does not match the declared column width is refused rather
 * than stored or compared: the similarity numbers would be meaningless and the
 * query would error at the database instead of degrading.
 */
export async function resolveQueryEmbedding(
  query: string,
  pipelineStep = 'assistant_retrieval_query_embedding'
): Promise<QueryEmbeddingResult> {
  // The provider call comes first and the model name second, deliberately.
  // `generateEmbedding` already answers null for an unconfigured install, and
  // reading the model up front would make every retrieval path depend on the
  // application config being loadable even when nothing is going to be embedded.
  //
  // Nothing in here may throw. A turn that cannot embed its question still has
  // a lexical arm, and failing retrieval outright because the embedding side is
  // misconfigured would turn a degradation into an outage.
  let vector: number[] | null = null
  try {
    vector = await generateEmbedding(query, { pipelineStep })
  } catch (err) {
    log.warn({ err }, 'query embedding failed; falling back to lexical retrieval')
  }
  const model = configuredEmbeddingModel()
  if (!vector) {
    return {
      embedding: null,
      degradedReason: model ? 'embedding_failed' : 'embeddings_unconfigured',
    }
  }
  if (vector.length !== RETRIEVAL_EMBEDDING_DIMENSIONS) {
    log.warn(
      { model, dimensions: vector.length, expected: RETRIEVAL_EMBEDDING_DIMENSIONS },
      'query embedding has an unexpected width; falling back to lexical retrieval'
    )
    return { embedding: null, degradedReason: 'embedding_dimension_mismatch' }
  }
  return {
    embedding: { model: model ?? 'unknown', dimensions: vector.length, vector },
    degradedReason: null,
  }
}

/**
 * The configured model name, or null when it cannot be read.
 *
 * Only ever used to label a vector that already exists, so a deployment whose
 * config cannot be loaded degrades to the lexical arm instead of failing a turn.
 */
function configuredEmbeddingModel(): string | null {
  try {
    return getEmbeddingModel()
  } catch {
    return null
  }
}

/** pgvector's literal form. One place, so no adapter builds it by hand. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`
}
