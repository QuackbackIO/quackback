/**
 * Auto-translate (domains/languages §H3, fast-follow). On publish of a
 * base-locale article, when helpCenterConfig.autoTranslate.enabled, one job
 * per enabled additional locale is queued through the existing feedback-ai
 * BullMQ queue (a second dedicated worker for one more rate-limit-sensitive
 * OpenAI-compatible call isn't warranted). The job translates the article
 * via the BYOK AI client and writes the result as a DRAFT translation --
 * never auto-published -- so a human always reviews before it goes live.
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
import { getChatModel } from '@/lib/server/domains/ai/models'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { getHelpCenterConfig } from '@/lib/server/domains/settings/settings.service'
import { getArticleById } from './help-center.article.service'
import { upsertArticleTranslation } from './help-center-translations.service'
import { logger } from '@/lib/server/logger'
import type { KbArticleId } from '@quackback/ids'
import type { HelpCenterArticleWithCategory } from './help-center.types'

const log = logger.child({ component: 'help-center-auto-translate' })

const TranslationResultSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  content: z.string(),
})

/**
 * Builds the chat messages for a translation call. Pure so the prompt shape
 * (protected-terms instruction, JSON contract) is unit-testable without a
 * live AI client.
 */
export function buildTranslationPrompt(input: {
  title: string
  description: string | null
  content: string
  locale: string
  protectedTerms: string[]
}): { system: string; user: string } {
  const glossaryLine =
    input.protectedTerms.length > 0
      ? `\n\nNever translate these terms; keep them exactly as written: ${input.protectedTerms.join(', ')}.`
      : ''

  const system = `You are a professional technical translator localizing help-center articles.
Translate the given title, description, and Markdown content into the locale "${input.locale}".
Preserve all Markdown formatting (headings, lists, links, code blocks) exactly -- translate
only the human-readable text, never code, URLs, or Markdown syntax.${glossaryLine}

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
  "content": "# Exporter vos données\\n\\nOuvrez **Paramètres** et choisissez *Exporter*."
}`

  const user = JSON.stringify({
    title: input.title,
    description: input.description ?? '',
    content: input.content,
  })

  return { system, user }
}

/** The job handler: translate one article into one locale, write a draft. */
export async function translateArticleForLocale(
  articleId: KbArticleId,
  locale: string
): Promise<void> {
  const model = getChatModel('helpCenterTranslate')
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !model) {
    log.debug({ article_id: articleId, locale }, 'auto-translate skipped: AI not configured')
    return
  }

  const helpCenterConfig = await getHelpCenterConfig()
  const protectedTerms = helpCenterConfig.autoTranslate?.protectedTerms ?? []

  const article = await getArticleById(articleId)
  const { system, user } = buildTranslationPrompt({
    title: article.title,
    description: article.description,
    content: article.content,
    locale,
    protectedTerms,
  })

  let parsed: z.infer<typeof TranslationResultSchema>
  try {
    parsed = await chat({
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
    return
  }
  if (!parsed.title || !parsed.content) {
    log.error({ article_id: articleId, locale }, 'auto-translate: incomplete AI response')
    return
  }

  await upsertArticleTranslation({
    articleId,
    locale,
    title: parsed.title,
    description: parsed.description || undefined,
    content: parsed.content,
    contentJson: markdownToTiptapJson(parsed.content),
  })
  log.info({ article_id: articleId, locale }, 'auto-translate: draft translation written')
}

/**
 * Called from publishArticle(). Fire-and-forget from the caller's
 * perspective -- enqueuing failures are logged, not thrown, so a translation
 * outage never blocks publishing the base article.
 */
export async function queueAutoTranslateOnPublish(
  article: HelpCenterArticleWithCategory
): Promise<void> {
  try {
    const helpCenterConfig = await getHelpCenterConfig()
    if (!helpCenterConfig.autoTranslate?.enabled) return
    const additionalLocales = helpCenterConfig.locales?.additional ?? []
    if (additionalLocales.length === 0) return

    const { enqueueHelpCenterTranslateJob } = await import('./help-center-translate-queue')
    await Promise.all(
      additionalLocales.map((locale) =>
        enqueueHelpCenterTranslateJob({
          type: 'translate-article',
          articleId: article.id,
          locale,
        })
      )
    )
  } catch (err) {
    log.error({ err, article_id: article.id }, 'failed to queue auto-translate jobs')
  }
}
