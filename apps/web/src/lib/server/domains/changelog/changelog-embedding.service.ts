/**
 * Changelog embedding service (Quinn Phase 4: changelog grounding).
 *
 * Embeds a published changelog entry for semantic retrieval
 * (changelog-retrieval.ts), mirroring the post-embedding hook pattern
 * (events/handlers/ai.ts): best-effort, fire-and-forget, logged on failure,
 * never thrown into its caller. Invoked from the changelog service at every
 * publish moment (`notifyChangelogPublished`, which the create/update/
 * scheduled/reconciler paths all funnel through) and on content edits
 * (`updateChangelog`).
 *
 * PUBLISHED ENTRIES ONLY: a draft or future-scheduled entry is skipped — its
 * embedding stays null until it is next published. Drafts are still
 * retrievable by the copilot via the keyword fallback (changelog-retrieval.ts),
 * so a missing embedding only costs semantic ranking, not visibility.
 *
 * No backfill job: entries that predate this column embed lazily the next time
 * they are edited or (re)published.
 */
import { db, changelogEntries, eq, isNull, sql, and, isNotNull, lte } from '@/lib/server/db'
import type { ChangelogId } from '@quackback/ids'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { getEmbeddingModel } from '@/lib/server/domains/ai/models'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'changelog-embedding' })

/**
 * Generate and persist the embedding for a changelog entry, if and only if it
 * is currently publicly live (published, not future-dated, not soft-deleted).
 * Best-effort: any failure (unconfigured AI, a provider error, a DB error) is
 * caught and logged, never thrown.
 */
export async function embedChangelogEntryOnPublish(id: ChangelogId): Promise<void> {
  try {
    const entry = await db.query.changelogEntries.findFirst({
      where: and(
        eq(changelogEntries.id, id),
        isNull(changelogEntries.deletedAt),
        isNotNull(changelogEntries.publishedAt),
        lte(changelogEntries.publishedAt, new Date())
      ),
      columns: { id: true, title: true, content: true },
    })
    // Not found, soft-deleted, a draft, or scheduled for the future: no embed.
    if (!entry) return

    const embedding = await generateEmbedding(`${entry.title}\n\n${entry.content}`, {
      pipelineStep: 'assistant_changelog_embedding',
    })
    if (!embedding) return // AI unconfigured or the call failed (already logged)

    await db
      .update(changelogEntries)
      .set({
        embedding: sql<number[]>`${`[${embedding.join(',')}]`}::vector`,
        embeddingModel: getEmbeddingModel() ?? 'unknown',
        embeddingUpdatedAt: new Date(),
      })
      .where(eq(changelogEntries.id, id))

    log.debug({ changelog_id: id }, 'changelog entry embedded')
  } catch (err) {
    log.error({ err, changelog_id: id }, 'changelog embedding failed')
  }
}
