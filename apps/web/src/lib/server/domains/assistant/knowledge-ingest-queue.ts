/**
 * The `assistant-knowledge-index` queue handler.
 *
 * Every import is static, deliberately: the job worker primes handler modules
 * once at tier start, outside any workspace scope, and that guarantee reaches
 * exactly as far as the static import graph
 * (jobs/__tests__/handler-imports.test.ts is the guard).
 *
 * Two payload shapes on one queue:
 *
 * - `source` indexes one source. Retries are safe because a generation is
 *   staged and only activated when it is complete, so a second attempt rebuilds
 *   rather than doubling anything, and an identical rebuild is recognised by its
 *   content hash and skipped.
 * - `backfill` claims a bounded page of never-indexed sources, requests an index
 *   for each and re-enqueues itself while there is more. Requesting writes the
 *   projection row first, so a claimed source leaves the unindexed query
 *   immediately and a pass that dies resumes exactly where it stopped.
 *
 * Ingestion runs at concurrency 1. A workspace importing a large help centre
 * must not compete with interactive turns for the process or the provider.
 */
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import type { AssistantIndexedSourceType } from '@/lib/server/db'
import {
  ASSISTANT_KNOWLEDGE_INDEX_QUEUE,
  indexKnowledgeSource,
  requestKnowledgeIndexing,
} from './knowledge-index.service'
import { pageUnindexedSources } from './knowledge-index.reads'

const log = logger.child({ component: 'assistant-knowledge-index-queue' })

export { ASSISTANT_KNOWLEDGE_INDEX_QUEUE }

/** Ingestion is background work: one at a time, so interactive turns keep the tier. */
export const ASSISTANT_KNOWLEDGE_INDEX_CONCURRENCY = 1

/** Extraction, chunking and a bounded run of embedding calls for one source. */
export const ASSISTANT_KNOWLEDGE_INDEX_LEASE_MS = 120_000

/** How many sources one backfill pass claims. */
export const BACKFILL_PAGE_SIZE = 25

/** Start (or resume) the bounded backfill over sources the projection has never seen. */
export async function enqueueKnowledgeBackfill(): Promise<void> {
  await enqueueJob({
    queue: ASSISTANT_KNOWLEDGE_INDEX_QUEUE,
    payload: { kind: 'backfill' },
    dedupeKey: 'assistant-knowledge-index:backfill',
    maxAttempts: 3,
  })
}

/**
 * The queue handler.
 *
 * An index outcome is data, not an error: a source whose text cannot be chunked
 * or whose embeddings failed is recorded on its own row and the job finishes,
 * because retrying it three times changes nothing and burns provider budget.
 * Only an unexpected throw reaches the queue's retry policy.
 */
export async function runKnowledgeIndexJob(job: ClaimedJob): Promise<void> {
  const kind = job.payload.kind as string | undefined
  if (kind === 'backfill') {
    const refs = await pageUnindexedSources(BACKFILL_PAGE_SIZE)
    for (const ref of refs) await requestKnowledgeIndexing(ref)
    log.info(
      { event: 'assistant_knowledge_index.backfill', claimed: refs.length },
      'knowledge backfill page claimed'
    )
    // A full page means there is probably more. A short page ends the sweep,
    // and the next source write (or an explicit restart) begins the next one.
    if (refs.length === BACKFILL_PAGE_SIZE) await enqueueKnowledgeBackfill()
    return
  }

  const sourceType = job.payload.sourceType as AssistantIndexedSourceType | undefined
  const sourceId = job.payload.sourceId as string | undefined
  if (!sourceType || !sourceId) throw new Error('assistant-knowledge-index job has no source')

  const outcome = await indexKnowledgeSource({ sourceType, sourceId })
  log.info(
    {
      event: 'assistant_knowledge_index.finished',
      job_id: job.jobId,
      source_type: sourceType,
      source_id: sourceId,
      outcome: outcome.kind,
      ...(outcome.kind === 'failed' ? { reason: outcome.reason, retained: outcome.retained } : {}),
    },
    'knowledge index job finished'
  )
}
