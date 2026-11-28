/**
 * AI translation of one article into one language. A missing language gets a
 * new draft; an existing translation that is behind its article gets an
 * update that waits beside its live text. AI never publishes and never
 * changes live text; a person reviews and publishes.
 *
 * Before the model sees the body, code, link and image targets, placeholders
 * and rich nodes are swapped for tokens (help-center-translation-text.ts);
 * after it answers, the result is checked (help-center-translation-checks.ts)
 * and the outcome stored with it. Queueing lives in
 * help-center-translation-upkeep.ts.
 */
import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { z } from 'zod'
import { config } from '@/lib/server/config'
import {
  isAiClientConfigured,
  structuredOutputProviderOptions,
} from '@/lib/server/domains/ai/config'
import { createUsageLoggingMiddleware } from '@/lib/server/domains/ai/usage-middleware'
import { getAiBudgetStatus } from '@/lib/server/domains/ai/ai-budget'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { markdownToTiptapJson, projectContentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { getHelpCenterConfig } from '@/lib/server/domains/settings/settings.service'
import type { GlossaryTranslation } from '@/lib/server/domains/settings/settings.types'
import { isFeatureLive } from '@/lib/server/domains/plan-limits/plan-limits.service'
import type { TiptapContent, TranslationCheckResult } from '@/lib/server/db'
import {
  getArticleTranslation,
  writeGuardedArticleTranslation,
} from './help-center-translations.service'
import {
  getArticleSourceForTranslation,
  writePendingTranslationUpdate,
} from './help-center-translation-versions.service'
import { prepareTranslationText, restoreTranslationText } from './help-center-translation-text'
import { checkTranslation } from './help-center-translation-checks'
import { logger } from '@/lib/server/logger'
import type { KbArticleId } from '@quackback/ids'
import { oneShotThreadId } from '@/lib/server/domains/ai/thread-id'

const log = logger.child({ component: 'help-center-auto-translate' })

const TranslationResultSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  content: z.string(),
})

/**
 * Builds the chat messages for a translation call. Pure so the prompt shape
 * (glossary instructions, token rule, JSON contract) is unit-testable without
 * a live AI client.
 */
export function buildTranslationPrompt(input: {
  title: string
  description: string | null
  content: string
  locale: string
  protectedTerms: string[]
  fixedTranslations?: readonly GlossaryTranslation[]
}): { system: string; user: string } {
  const glossaryLine =
    input.protectedTerms.length > 0
      ? `\n\nNever translate these terms; keep them exactly as written: ${input.protectedTerms.join(', ')}.`
      : ''
  const fixed = (input.fixedTranslations ?? []).filter((t) => t.term && t.translation)
  const fixedLine =
    fixed.length > 0
      ? `\n\nAlways translate these terms exactly this way:\n${fixed.map((t) => `- ${t.term} -> ${t.translation}`).join('\n')}`
      : ''

  const system = `You are a professional technical translator localizing help-center articles.
Translate the given title, description, and Markdown content into the locale "${input.locale}".
Preserve all Markdown formatting (headings, lists, links, code blocks) exactly -- translate
only the human-readable text, never code, URLs, or Markdown syntax. Translate link text and
image alt text. Keep every token written like ⟦C0⟧, ⟦I0⟧, ⟦U0⟧, ⟦P0⟧ or ⟦N0⟧ exactly as it
is, once, in the matching place.${glossaryLine}${fixedLine}

Return strict JSON only:
{
  "title": "string",
  "description": "string",
  "content": "string"
}

Example output:
{
  "title": "Exporter vos données",
  "description": "Comment exporter les données de votre espace de travail.",
  "content": "# Exporter vos données\\n\\nOuvrez **Paramètres** et choisissez *Exporter* ⟦I0⟧."
}`

  const user = JSON.stringify({
    title: input.title,
    description: input.description ?? '',
    content: input.content,
  })

  return { system, user }
}

/** A parked job's snapshot of the translation it may replace. */
export interface ParkedTranslationGuard {
  /** The translation's updated_at when parked, or null when there was none. */
  translationUpdatedAt: string | null
}

/** True when the translation still is what the parked job saw. */
async function translationUnchanged(
  articleId: KbArticleId,
  locale: string,
  guard: ParkedTranslationGuard
): Promise<boolean> {
  const row = await getArticleTranslation(articleId, locale)
  const current = row ? row.updatedAt.toISOString() : null
  return current === guard.translationUpdatedAt
}

/** Returned instead of translating when the AI allowance is used up. */
export interface AutoTranslatePause {
  /** When the allowance window ends; the caller retries no later than this. */
  pausedUntil: Date
}

/** What one translation run did. */
export type ArticleTranslationOutcome =
  | { kind: 'draft'; check: TranslationCheckResult }
  | { kind: 'update'; check: TranslationCheckResult }
  | { kind: 'paused'; pausedUntil: Date }
  | {
      kind: 'skipped'
      reason:
        | 'unavailable'
        | 'held'
        | 'not_found'
        | 'current'
        | 'update_waiting'
        | 'discarded'
        | 'changed'
        | 'failed'
    }

export interface TranslateArticleOptions {
  guard?: ParkedTranslationGuard
  /**
   * 'auto' (the queue) leaves any update already waiting for the current
   * version, and makes none for a version whose update a person discarded.
   * 'request' (a person's "Update with AI") replaces one that failed its
   * checks.
   */
  mode?: 'auto' | 'request'
}

/**
 * Translate one article into one language: a draft for a missing language,
 * a waiting update for one behind its article.
 *
 * Checks the AI allowance before the model call, so a used-up allowance costs
 * nothing and writes nothing; the caller parks the item and retries it.
 */
export async function runArticleTranslation(
  articleId: KbArticleId,
  locale: string,
  opts: TranslateArticleOptions = {}
): Promise<ArticleTranslationOutcome> {
  if (!(await isFeatureLive('aiArticleTranslation'))) {
    log.debug({ article_id: articleId, locale }, 'auto-translate skipped: plan excludes it')
    return { kind: 'skipped', reason: 'unavailable' }
  }
  const model = getChatModel('helpCenterTranslate')
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !model) {
    log.debug({ article_id: articleId, locale }, 'auto-translate skipped: AI not configured')
    return { kind: 'skipped', reason: 'unavailable' }
  }

  const budget = await getAiBudgetStatus()
  if (budget.exhausted) {
    log.info(
      { article_id: articleId, locale, resume_at: budget.window.end.toISOString() },
      'auto-translate paused: AI allowance used up'
    )
    return { kind: 'paused', pausedUntil: budget.window.end }
  }

  // A job that was parked does not act on a translation a person changed
  // while it waited; the catch-up queues it again if it is still behind.
  if (opts.guard && !(await translationUnchanged(articleId, locale, opts.guard))) {
    log.info({ article_id: articleId, locale }, 'auto-translate skipped: translation changed')
    return { kind: 'skipped', reason: 'changed' }
  }

  const [source, existing] = await Promise.all([
    getArticleSourceForTranslation(articleId),
    getArticleTranslation(articleId, locale),
  ])
  if (!source) return { kind: 'skipped', reason: 'not_found' }
  if (existing) {
    if (existing.sourceRevision >= source.revision) {
      return { kind: 'skipped', reason: 'current' }
    }
    const waiting = existing.pendingSourceRevision !== null && existing.pendingTitle !== null
    const waitingCurrent = waiting && existing.pendingSourceRevision! >= source.revision
    const waitingOk = existing.checkResult?.ok !== false
    if (waitingCurrent && (opts.mode !== 'request' || waitingOk)) {
      return { kind: 'skipped', reason: 'update_waiting' }
    }
    // A person discarded the update for this version; only they ask again.
    const discarded =
      existing.pendingTitle === null &&
      existing.pendingSourceRevision !== null &&
      existing.pendingSourceRevision >= source.revision
    if (discarded && opts.mode !== 'request') {
      return { kind: 'skipped', reason: 'discarded' }
    }
  }

  const helpCenterConfig = await getHelpCenterConfig()
  // A language the plan holds back is not translated into.
  const { heldHelpCenterLocales } =
    await import('@/lib/server/domains/plan-limits/plan-limits.locales')
  if ((await heldHelpCenterLocales(helpCenterConfig.locales?.additional ?? [])).includes(locale)) {
    log.info({ article_id: articleId, locale }, 'auto-translate skipped: language held by the plan')
    return { kind: 'skipped', reason: 'held' }
  }
  const protectedTerms = helpCenterConfig.autoTranslate?.protectedTerms ?? []
  const fixedTranslations = helpCenterConfig.autoTranslate?.fixedTranslations?.[locale] ?? []

  const sourceBody: TiptapContent = source.contentJson ?? markdownToTiptapJson(source.text.content)
  const prepared = prepareTranslationText(sourceBody)
  const { system, user } = buildTranslationPrompt({
    title: source.text.title,
    description: source.text.description,
    content: prepared.markdown,
    locale,
    protectedTerms,
    fixedTranslations,
  })

  let parsed: z.infer<typeof TranslationResultSchema>
  try {
    parsed = await chat({
      threadId: oneShotThreadId(),
      adapter: openaiCompatibleText(model, {
        baseURL: config.openaiBaseUrl!,
        apiKey: config.openaiApiKey!,
      }),
      systemPrompts: [system],
      messages: [{ role: 'user', content: user }],
      outputSchema: TranslationResultSchema,
      stream: false,
      modelOptions: { ...structuredOutputProviderOptions() },
      middleware: [
        createUsageLoggingMiddleware({
          pipelineStep: 'help_center_translate',
          model,
          metadata: { articleId, locale },
        }),
      ],
    })
  } catch (err) {
    log.error({ err, article_id: articleId, locale }, 'auto-translate: unparseable AI response')
    return { kind: 'skipped', reason: 'failed' }
  }
  if (!parsed.title || !parsed.content) {
    log.error({ article_id: articleId, locale }, 'auto-translate: incomplete AI response')
    return { kind: 'skipped', reason: 'failed' }
  }

  const restored = restoreTranslationText(parsed.content, prepared)
  const check = checkTranslation({
    source: { title: source.text.title, body: sourceBody },
    result: { title: parsed.title, body: restored.contentJson },
    protectedTerms,
  })
  const result = {
    title: parsed.title,
    description: parsed.description || null,
    content: projectContentJsonToMarkdown(
      restored.contentJson,
      restored.markdown.replace(/⟦\s*N\s*\d+\s*⟧/g, '')
    ),
    contentJson: restored.contentJson,
  }

  if (existing) {
    const written = await writePendingTranslationUpdate(articleId, locale, {
      ...result,
      sourceRevision: source.revision,
      sourceText: source.text,
      check,
    })
    if (!written) {
      log.info({ article_id: articleId, locale }, 'auto-translate skipped: translation current')
      return { kind: 'skipped', reason: 'current' }
    }
    log.info({ article_id: articleId, locale, ok: check.ok }, 'auto-translate: update waiting')
    return { kind: 'update', check }
  }

  // Insert only: a version a person saved while the AI call ran stays.
  const written = await writeGuardedArticleTranslation(
    {
      articleId,
      locale,
      ...result,
      source: { revision: source.revision, text: source.text },
      checkResult: check,
    },
    null
  )
  if (!written) {
    log.info({ article_id: articleId, locale }, 'auto-translate skipped: a version exists')
    return { kind: 'skipped', reason: 'changed' }
  }
  log.info({ article_id: articleId, locale, ok: check.ok }, 'auto-translate: draft written')
  return { kind: 'draft', check }
}

/** The queue's entry point: the pause to park on, or nothing. */
export async function translateArticleForLocale(
  articleId: KbArticleId,
  locale: string,
  opts: TranslateArticleOptions = {}
): Promise<AutoTranslatePause | undefined> {
  const outcome = await runArticleTranslation(articleId, locale, opts)
  return outcome.kind === 'paused' ? { pausedUntil: outcome.pausedUntil } : undefined
}
