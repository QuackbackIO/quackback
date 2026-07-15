/**
 * Per-scenario fixture seeding, all inside the db-test-fixture rollback
 * transaction (harness/db.ts rebinds the global `db` to it, so the runtime's
 * own reads see these rows and everything vanishes at rollback). Keep fixtures
 * small and anonymized (§7.2).
 *
 * Existing domain helpers are reused by IMPORT, never copied:
 *  - `ensureAssistantPrincipal` provisions Quinn's service principal
 *  - `generateKbEmbedding` / `formatArticleText` embed seeded articles with the
 *    configured model (the same path production embeds through)
 *  - `openInvolvement` opens the involvement a live write turn audits against
 */
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type AssistantInvolvementId,
} from '@quackback/ids'
import {
  sql,
  eq,
  settings,
  principal,
  user,
  conversations,
  helpCenterArticles,
  helpCenterCategories,
  assistantGuidanceRules,
  conversationAttributeDefinitions,
  tickets,
  ticketStatuses,
  ticketSummaries,
  changelogEntries,
} from '@/lib/server/db'
import { testDb } from '@/lib/server/__tests__/db-test-fixture'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'
import { ensureAssistantPrincipal } from '@/lib/server/domains/assistant'
import { openInvolvement } from '@/lib/server/domains/assistant/assistant.involvement'
import {
  generateKbEmbedding,
  formatArticleText,
} from '@/lib/server/domains/help-center/help-center-embedding.service'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { getEmbeddingModel } from '@/lib/server/domains/ai/models'
import type {
  Fixtures,
  ScenarioConfig,
  SeedChangelogEntry,
  SeedGuidance,
  SeedKbArticle,
  SeedTicketSummary,
} from '../types'

function suffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Write the scenario's config onto the singleton settings row (v3 schema:
 * shared identity + per-agent sub-objects). Directly mutates the jsonb/flags
 * columns rather than going through the revision-locked write funnel, because a
 * scenario is a fresh transaction, not a concurrent admin. Scenario tone/length
 * map onto the Agent's voice (the customer-facing config).
 */
export async function applyScenarioSettings(config: ScenarioConfig = {}): Promise<void> {
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (!row) {
    throw new Error(
      '[evals] No settings row in the test database. Seed the dev/test DB first ' +
        '(bun run db:seed) so the workspace singleton exists.'
    )
  }
  const assistantConfig = {
    ...DEFAULT_ASSISTANT_CONFIG,
    agents: {
      ...DEFAULT_ASSISTANT_CONFIG.agents,
      agent: {
        ...DEFAULT_ASSISTANT_CONFIG.agents.agent,
        voice: {
          tone: config.tone ?? DEFAULT_ASSISTANT_CONFIG.agents.agent.voice.tone,
          responseLength:
            config.responseLength ?? DEFAULT_ASSISTANT_CONFIG.agents.agent.voice.responseLength,
          additionalInstructions: config.additionalInstructions ?? '',
        },
      },
    },
  }
  const featureFlags = JSON.stringify({
    assistantTools: config.assistantTools === true,
    assistantKnowledge: config.assistantKnowledge === true,
  })
  await testDb
    .update(settings)
    .set({ assistantConfig, featureFlags })
    .where(eq(settings.id, row.id))
}

/** Find-or-create Quinn's service principal inside the transaction. */
export async function seedAssistantPrincipal(): Promise<PrincipalId> {
  const p = await ensureAssistantPrincipal()
  return p.id as PrincipalId
}

/**
 * Seed a public (Agent-visible) or team-only (Copilot-only) KB article with a
 * real embedding. Fails loudly if the embedding endpoint returns nothing —
 * grounding scenarios cannot retrieve without it.
 */
export async function seedKbArticle(
  authorPrincipalId: PrincipalId,
  article: SeedKbArticle
): Promise<string> {
  const isPublic = article.isPublic ?? true
  const categoryId = createId('kb_category')
  await testDb.insert(helpCenterCategories).values({
    id: categoryId,
    slug: `eval-cat-${suffix()}`,
    name: 'Eval Knowledge',
    isPublic,
    segmentIds: [],
  })

  const articleId = createId('kb_article')
  await testDb.insert(helpCenterArticles).values({
    id: articleId,
    categoryId,
    slug: `eval-art-${suffix()}`,
    title: article.title,
    content: article.content,
    principalId: authorPrincipalId,
    // Published a beat in the past so the `publishedAt <= now()` filter passes.
    publishedAt: new Date(Date.now() - 60_000),
  })

  const embedding = await generateKbEmbedding(
    formatArticleText(article.title, article.content, 'Eval Knowledge'),
    { pipelineStep: 'eval_seed' }
  )
  if (!embedding) {
    throw new Error(
      '[evals] Embedding generation returned null while seeding a KB article. ' +
        'Check OPENAI_API_KEY/OPENAI_BASE_URL and AI_EMBEDDING_MODEL.'
    )
  }
  const vectorLiteral = `[${embedding.join(',')}]`
  await testDb
    .update(helpCenterArticles)
    .set({
      embedding: sql`${vectorLiteral}::vector`,
      embeddingModel: getEmbeddingModel() ?? 'unknown',
      embeddingUpdatedAt: new Date(),
    })
    .where(eq(helpCenterArticles.id, articleId))

  return articleId
}

/**
 * Embed `text` with the configured model (the same path retrieval embeds
 * queries through), failing loudly if the endpoint returns nothing — a
 * grounding scenario cannot retrieve without a vector. Returns a pgvector
 * literal ready for a `::vector` cast.
 */
async function embedOrThrow(text: string, what: string): Promise<string> {
  const embedding = await generateEmbedding(text, { pipelineStep: 'eval_seed' })
  if (!embedding) {
    throw new Error(
      `[evals] Embedding generation returned null while seeding a ${what}. ` +
        'Check OPENAI_API_KEY/OPENAI_BASE_URL and AI_EMBEDDING_MODEL.'
    )
  }
  return `[${embedding.join(',')}]`
}

/** Find-or-create a ticket status so a seeded ticket has a valid FK target. */
async function ensureTicketStatusId() {
  const [existing] = await testDb.select({ id: ticketStatuses.id }).from(ticketStatuses).limit(1)
  if (existing) return existing.id
  const id = createId('ticket_status')
  await testDb.insert(ticketStatuses).values({
    id,
    name: 'Closed',
    slug: `eval-closed-${suffix()}`,
    category: 'closed',
    position: 0,
  })
  return id
}

/**
 * Seed a closed-ticket resolution summary with a real embedding, backed by a
 * throwaway ticket (+ status) to satisfy the FK. Team-only knowledge: only the
 * copilot ever retrieves it (see `tickets-retrieval.ts`).
 */
export async function seedTicketSummary(ticket: SeedTicketSummary): Promise<string> {
  const statusId = await ensureTicketStatusId()
  const ticketId = createId('ticket')
  await testDb.insert(tickets).values({
    id: ticketId,
    type: 'customer',
    title: 'Eval resolved ticket',
    statusId,
  })
  const vectorLiteral = await embedOrThrow(ticket.summary, 'ticket summary')
  await testDb.insert(ticketSummaries).values({
    id: createId('ticket_summary'),
    ticketId,
    summary: ticket.summary,
    embedding: sql`${vectorLiteral}::vector`,
    embeddingModel: getEmbeddingModel() ?? 'unknown',
    embeddingUpdatedAt: new Date(),
  })
  return ticketId
}

/**
 * Seed a changelog entry with a real embedding. A published entry is
 * customer-visible (public `/changelog/<id>` citation); a draft
 * (`published: false`) is team-only and trips the copilot leak gate.
 */
export async function seedChangelogEntry(entry: SeedChangelogEntry): Promise<string> {
  const isPublished = entry.published ?? true
  const entryId = createId('changelog')
  const vectorLiteral = await embedOrThrow(`${entry.title}\n\n${entry.content}`, 'changelog entry')
  await testDb.insert(changelogEntries).values({
    id: entryId,
    title: entry.title,
    content: entry.content,
    // Published a beat in the past so the `published_at <= now()` filter passes;
    // a draft leaves it null (never retrievable at a public ceiling).
    publishedAt: isPublished ? new Date(Date.now() - 60_000) : null,
    embedding: sql`${vectorLiteral}::vector`,
    embeddingModel: getEmbeddingModel() ?? 'unknown',
    embeddingUpdatedAt: new Date(),
  })
  return entryId
}

export async function seedGuidanceRule(rule: SeedGuidance): Promise<void> {
  await testDb.insert(assistantGuidanceRules).values({
    id: createId('assistant_guidance'),
    name: rule.name,
    instruction: rule.instruction,
    appliesWhen: rule.appliesWhen ?? null,
    agent: rule.agent ?? 'agent',
    enabled: rule.enabled ?? true,
    priority: rule.priority ?? 0,
  })
}

export async function seedAttribute(attr: {
  key: string
  label: string
  fieldType?: 'text' | 'select'
  options?: { id: string; label: string }[]
}): Promise<void> {
  await testDb.insert(conversationAttributeDefinitions).values({
    id: createId('conversation_attribute'),
    key: attr.key,
    label: attr.label,
    fieldType: attr.fieldType ?? 'text',
    options: attr.options ?? null,
  })
}

export interface SeededConversation {
  conversationId: ConversationId
  involvementId: AssistantInvolvementId
  customerPrincipalId: PrincipalId
  latestCustomerMessageId: string
}

/** Seed a customer + conversation + open involvement for live write turns. */
export async function seedConversation(): Promise<SeededConversation> {
  const userId = createId('user')
  const customerPrincipalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: 'Eval Customer',
    email: `eval-${suffix()}@example.test`,
  })
  await testDb.insert(principal).values({
    id: customerPrincipalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Eval Customer',
    createdAt: new Date(),
  })
  const conversationId = createId('conversation') as ConversationId
  await testDb.insert(conversations).values({
    id: conversationId,
    visitorPrincipalId: customerPrincipalId,
    channel: 'messenger',
    status: 'open',
  })
  const involvement = await openInvolvement({ conversationId, triggeredBy: 'first_touch' }, testDb)
  return {
    conversationId,
    involvementId: involvement.id,
    customerPrincipalId,
    // Only used as the write-tool idempotency key; not an FK, so a plain
    // stable string is enough.
    latestCustomerMessageId: `eval-msg-${suffix()}`,
  }
}

/** Seed everything a scenario declares; returns handles the runner threads in. */
export interface SeedResult {
  assistantPrincipalId: PrincipalId
  conversation?: SeededConversation
}

export async function seedFixtures(
  config: ScenarioConfig | undefined,
  fixtures: Fixtures | undefined,
  opts: { forceConversation?: boolean } = {}
): Promise<SeedResult> {
  await applyScenarioSettings(config)
  const assistantPrincipalId = await seedAssistantPrincipal()

  for (const article of fixtures?.kbArticles ?? []) {
    await seedKbArticle(assistantPrincipalId, article)
  }
  for (const ticket of fixtures?.ticketSummaries ?? []) {
    await seedTicketSummary(ticket)
  }
  for (const entry of fixtures?.changelogEntries ?? []) {
    await seedChangelogEntry(entry)
  }
  for (const rule of fixtures?.guidance ?? []) {
    await seedGuidanceRule(rule)
  }
  for (const attr of fixtures?.attributes ?? []) {
    await seedAttribute(attr)
  }

  // Conversation seeding is opt-in per scenario. A real conversationId engages
  // the runtime's conversation-scoped machinery (the zero-tool completion
  // guard, live write execution); scenarios that assert on writes (21/22) or
  // want the full guard set it via fixtures.withConversation. Answer/voice
  // scenarios run the sandbox path (conversationId null) — the same isolation
  // the admin Test agent uses — which keeps them off the (model-dependent)
  // zero-tool evaluator.
  const conversation =
    fixtures?.withConversation || opts.forceConversation ? await seedConversation() : undefined
  return { assistantPrincipalId, conversation }
}
