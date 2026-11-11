/**
 * Fit a provider's embedding to the width of the pgvector columns.
 *
 * The `embedding` columns are `vector(1536)` and requests ask for
 * `dimensions: 1536`, but several OpenAI-compatible servers ignore that
 * parameter and return their model's native width (bge-m3 on Cloudflare
 * Workers AI returns 1024). Writing that vector fails on insert, so similarity
 * search, duplicate detection and help-center search silently stop working.
 *
 * With `AI_EMBEDDING_ZERO_PAD=true` a shorter vector is padded with zeros.
 * Trailing zeros change neither dot products nor norms, so cosine similarity
 * between padded vectors is exactly the model's own. A vector of any other
 * width is refused with an error that names both widths.
 */
import { logger } from '@/lib/server/logger'
import { embeddingZeroPadEnabled } from './config'

const log = logger.child({ component: 'embeddings' })

export function padEmbedding(vector: number[], dimensions: number): number[] {
  if (vector.length >= dimensions) return vector
  return vector.concat(new Array<number>(dimensions - vector.length).fill(0))
}

export function fitEmbeddingDimensions(
  vector: number[] | undefined | null,
  dimensions: number,
  context: { model: string; pipelineStep?: string },
  zeroPad?: boolean
): number[] | null {
  if (!vector) return null
  if (vector.length === dimensions) return vector
  if (vector.length < dimensions && (zeroPad ?? embeddingZeroPadEnabled()))
    return padEmbedding(vector, dimensions)
  log.error(
    {
      model: context.model,
      pipeline_step: context.pipelineStep,
      returned_dimensions: vector.length,
      expected_dimensions: dimensions,
    },
    vector.length < dimensions
      ? 'embedding is narrower than the vector column; set AI_EMBEDDING_ZERO_PAD=true to pad it'
      : 'embedding is wider than the vector column'
  )
  return null
}
