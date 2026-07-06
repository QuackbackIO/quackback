/**
 * Snippets — short, private facts an admin curates for Quinn to ground
 * answers on, alongside the knowledge base and (when enabled) feedback
 * posts. Unlike a guidance rule (which steers HOW Quinn answers), a snippet
 * IS an answerable fact, retrieved the same way a KB article is
 * (`snippets-retrieval.ts`). Pure CRUD plus embed-on-write: creating a
 * snippet, or changing its title/content, (re)generates its embedding from
 * `title + '\n' + content` via the shared embedding service. Embedding is
 * synchronous (this is an admin-latency path, not a hot one) but never
 * blocks the write — a generation failure is caught and logged, leaving the
 * row saved with a null embedding rather than failing the CRUD call.
 */
import { db, eq, desc, sql, assistantSnippets, type AssistantSnippet } from '@/lib/server/db'
import type { AssistantSnippetId, PrincipalId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import { CONTENT_AUDIENCE_RANK, type ContentAudience } from './audience'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { getEmbeddingModel } from '@/lib/server/domains/ai/models'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-snippets' })

const TITLE_MAX_LENGTH = 120
const CONTENT_MAX_LENGTH = 2000

export interface SnippetInput {
  title: string
  content: string
  audience?: ContentAudience
  enabled?: boolean
}

function validateSnippetInput(input: Partial<SnippetInput>): void {
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) throw new ValidationError('VALIDATION_ERROR', 'Title is required')
    if (title.length > TITLE_MAX_LENGTH) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        `Title must be ${TITLE_MAX_LENGTH} characters or fewer`
      )
    }
  }
  if (input.content !== undefined) {
    const content = input.content.trim()
    if (!content) throw new ValidationError('VALIDATION_ERROR', 'Content is required')
    if (content.length > CONTENT_MAX_LENGTH) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        `Content must be ${CONTENT_MAX_LENGTH} characters or fewer`
      )
    }
  }
  if (input.audience !== undefined && !(input.audience in CONTENT_AUDIENCE_RANK)) {
    throw new ValidationError('VALIDATION_ERROR', `Unknown audience: ${input.audience}`)
  }
}

/**
 * (Re)generate a snippet's embedding from its title + content and persist it,
 * in a dedicated update call — mirrors `generateArticleEmbedding` (help
 * center) rather than folding the vector into the plain-field patch. Never
 * throws: a provider failure (or no configured embedding model) is logged
 * and the caller's row is left as-is (embedding stays whatever it was,
 * typically null on create).
 */
async function embedSnippet(
  id: AssistantSnippetId,
  title: string,
  content: string
): Promise<AssistantSnippet | null> {
  try {
    const vector = await generateEmbedding(`${title}\n${content}`, {
      pipelineStep: 'assistant_snippet_embedding',
    })
    if (!vector) return null
    const vectorStr = `[${vector.join(',')}]`
    const [row] = await db
      .update(assistantSnippets)
      .set({
        embedding: sql<number[]>`${vectorStr}::vector`,
        embeddingModel: getEmbeddingModel() ?? 'unknown',
        embeddingUpdatedAt: new Date(),
      })
      .where(eq(assistantSnippets.id, id))
      .returning()
    return row ?? null
  } catch (error) {
    log.error({ err: error, snippet_id: id }, 'snippet embedding generation failed')
    return null
  }
}

export async function createSnippet(
  input: SnippetInput & { createdById?: PrincipalId }
): Promise<AssistantSnippet> {
  validateSnippetInput(input)
  const [row] = await db
    .insert(assistantSnippets)
    .values({
      title: input.title.trim(),
      content: input.content.trim(),
      audience: input.audience ?? 'team',
      enabled: input.enabled ?? true,
      createdById: input.createdById ?? null,
    })
    .returning()
  const embedded = await embedSnippet(row.id, row.title, row.content)
  return embedded ?? row
}

/** All snippets, enabled or not — the admin list shows every snippet. */
export async function listSnippets(): Promise<AssistantSnippet[]> {
  return db.select().from(assistantSnippets).orderBy(desc(assistantSnippets.createdAt))
}

export async function updateSnippet(
  id: AssistantSnippetId,
  patch: Partial<SnippetInput>
): Promise<AssistantSnippet | null> {
  validateSnippetInput(patch)
  const values: Partial<typeof assistantSnippets.$inferInsert> = { updatedAt: new Date() }
  if (patch.title !== undefined) values.title = patch.title.trim()
  if (patch.content !== undefined) values.content = patch.content.trim()
  if (patch.audience !== undefined) values.audience = patch.audience
  if (patch.enabled !== undefined) values.enabled = patch.enabled

  const [row] = await db
    .update(assistantSnippets)
    .set(values)
    .where(eq(assistantSnippets.id, id))
    .returning()
  if (!row) return null

  if (patch.title !== undefined || patch.content !== undefined) {
    const embedded = await embedSnippet(row.id, row.title, row.content)
    return embedded ?? row
  }
  return row
}

export async function deleteSnippet(id: AssistantSnippetId): Promise<void> {
  await db.delete(assistantSnippets).where(eq(assistantSnippets.id, id))
}
