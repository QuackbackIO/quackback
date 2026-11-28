import type { getArticleLanguagesFn } from '@/lib/server/functions/help-center-article-languages'
import type { LanguageDotState } from './article-language-bar'

export type ArticleLanguages = Awaited<ReturnType<typeof getArticleLanguagesFn>>
export type ArticleLanguageEntry = ArticleLanguages['languages'][number]

/** The dot the language bar shows for a language. */
export function languageDotState(entry: ArticleLanguageEntry): LanguageDotState {
  if (entry.status === 'untranslated') return 'missing'
  if (entry.needsUpdate || entry.pendingUpdate) return 'needs_update'
  return entry.status === 'published' ? 'published' : 'draft'
}
