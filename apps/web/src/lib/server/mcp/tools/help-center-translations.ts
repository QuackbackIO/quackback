/**
 * Help center translations over MCP: the translate_article tool, and the
 * language-aware parts of update_article, manage_category, get_details and
 * search. They call the same service functions as the editor and the REST API.
 */
import { PERMISSIONS } from '@/lib/shared/permissions'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/server'
import type { KbArticleId, KbCategoryId } from '@quackback/ids'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { getArticleById } from '@/lib/server/domains/help-center/help-center.service'
import { getArticleTranslation } from '@/lib/server/domains/help-center/help-center-translations.service'
import {
  discardArticleTranslationUpdate,
  listArticleTranslationSummaries,
  markArticleTranslationUpToDate,
  parseTranslationLocale,
  publishArticleTranslationUpdate,
  readArticleInLanguage,
  removeArticleTranslation,
  removeCategoryTranslation,
  requestArticleAiTranslation,
  setArticleLanguageStatus,
  writeArticleTranslation,
  writeCategoryTranslation,
} from '@/lib/server/domains/help-center/help-center-translation-api'
import type { McpAuthContext } from '../types'
import { registerTool, jsonResult, errorResult, WRITE, articleResult } from './helpers'

export const LOCALE_DESCRIBE =
  'A product language code (en, de, fr, es, ar, ru, pt-br, zh-cn, zh-tw, nl, pl, th, uk).'

const translateArticleSchema = {
  articleId: z.string().describe('Article TypeID'),
  locale: z.string().describe(`The language to act on. ${LOCALE_DESCRIBE}`),
  action: z
    .enum(['ai', 'publish_update', 'discard_update', 'mark_current'])
    .default('ai')
    .describe(
      '"ai" (default): AI translates the article now. A missing language gets a draft; an existing translation gets an update waiting for review, never a change to its live text. "publish_update" makes a waiting update live; "discard_update" drops it; "mark_current" says the translation already matches the article.'
    ),
}

type TranslateArticleArgs = {
  articleId: string
  locale: string
  action?: 'ai' | 'publish_update' | 'discard_update' | 'mark_current'
}

export function registerHelpCenterTranslationTools(server: McpServer, auth: McpAuthContext) {
  registerTool<TranslateArticleArgs>(server, auth, {
    name: 'translate_article',
    title: 'Translate help center article',
    permissions: [PERMISSIONS.HELP_CENTER_MANAGE],
    description: `Translate a help center article with AI, or act on an AI update waiting for review. AI never publishes and never changes live text: a person (or this tool's publish_update) does.

Examples:
- Draft a missing language: translate_article({ articleId: "article_01abc...", locale: "de" })
- Publish the waiting update: translate_article({ articleId: "article_01abc...", locale: "de", action: "publish_update" })
- Already right: translate_article({ articleId: "article_01abc...", locale: "fr", action: "mark_current" })`,
    schema: translateArticleSchema,
    annotations: WRITE,
    feature: 'helpCenter',
    scope: 'write:article',
    teamOnly: true,
    handler: async (args) => {
      const articleId = parseTypeId<KbArticleId>(args.articleId, 'article', 'article ID')
      const locale = parseTranslationLocale(args.locale)
      switch (args.action ?? 'ai') {
        case 'ai': {
          const outcome = await requestArticleAiTranslation(articleId, locale)
          return jsonResult({ articleId, locale, ...outcome })
        }
        case 'publish_update':
          return jsonResult(await publishArticleTranslationUpdate(articleId, locale))
        case 'discard_update':
          return jsonResult(await discardArticleTranslationUpdate(articleId, locale))
        case 'mark_current':
          return jsonResult(await markArticleTranslationUpToDate(articleId, locale))
      }
    },
  })
}

/** get_details for an article: in one language when asked, with its translations. */
export async function articleDetailsResult(
  articleId: KbArticleId,
  locale?: string
): Promise<CallToolResult> {
  const article = await getArticleById(articleId)
  const translations = await listArticleTranslationSummaries(articleId, article.textRevision)
  if (!locale) return articleResult({ ...article, translations })
  const text = await readArticleInLanguage(article, parseTranslationLocale(locale), {
    includeDrafts: true,
  })
  // The text is already Markdown in the asked language; the rich body is the article's own.
  return articleResult({ ...article, ...text, contentJson: null, translations })
}

/** update_article's language arguments, applied to one translation. */
export async function updateArticleLanguage(args: {
  articleId: string
  locale?: string
  removeLocale?: string
  title?: string
  description?: string
  content?: string
  publishedAt?: string | null
}): Promise<CallToolResult> {
  const articleId = parseTypeId<KbArticleId>(args.articleId, 'article', 'article ID')
  if (args.removeLocale) {
    const locale = parseTranslationLocale(args.removeLocale)
    await removeArticleTranslation(articleId, locale)
    return jsonResult({ articleId, removedLocale: locale })
  }
  const locale = parseTranslationLocale(args.locale!)
  const existing = await getArticleTranslation(articleId, locale)
  const status =
    args.publishedAt === undefined ? undefined : args.publishedAt ? 'published' : 'draft'
  const textGiven =
    args.title !== undefined || args.description !== undefined || args.content !== undefined
  // Publishing or unpublishing alone leaves the text, its rich body and
  // whether it is up to date exactly as they are.
  if (existing && !textGiven) {
    if (!status) {
      return errorResult(new Error('Give a title, description, content or publishedAt to change'))
    }
    const translation = await setArticleLanguageStatus(articleId, locale, status)
    return jsonResult({ articleId, translation })
  }
  const title = args.title ?? existing?.title
  if (!title || args.content === '' || (!existing && !args.content)) {
    return errorResult(
      new Error('title and content are required to add a language the article does not have yet')
    )
  }
  // Without new content the stored body is kept whole, embeds and image sizes included.
  const body =
    args.content !== undefined || !existing
      ? { content: args.content ?? '' }
      : { content: existing.content, contentJson: existing.contentJson }
  const summary = await writeArticleTranslation(articleId, locale, {
    title,
    description: args.description ?? existing?.description ?? null,
    ...body,
    status,
  })
  return jsonResult({ articleId, translation: summary })
}

/** manage_category with a locale: the collection's name in that language. */
export async function manageCategoryLanguage(args: {
  action: 'create' | 'update' | 'delete'
  categoryId?: string
  locale: string
  name?: string
  description?: string | null
}): Promise<CallToolResult> {
  if (args.action === 'create' || !args.categoryId) {
    return errorResult(
      new Error('locale works with update or delete on an existing category (categoryId)')
    )
  }
  const categoryId = parseTypeId<KbCategoryId>(args.categoryId, 'kb_category', 'category ID')
  const locale = parseTranslationLocale(args.locale)
  if (args.action === 'delete') {
    await removeCategoryTranslation(categoryId, locale)
    return jsonResult({ categoryId, removedLocale: locale })
  }
  if (!args.name) return errorResult(new Error('name is required to set a category name'))
  const translation = await writeCategoryTranslation(categoryId, locale, {
    name: args.name,
    description: args.description,
  })
  return jsonResult({ categoryId, translation })
}
