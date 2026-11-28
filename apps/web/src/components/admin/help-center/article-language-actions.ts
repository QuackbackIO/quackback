import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { errorText } from '@/lib/client/error-text'
import { requestArticleAiTranslationFn } from '@/lib/server/functions/help-center-article-languages'
import { helpCenterKeys } from '@/lib/client/queries/help-center'
import type { SupportedLocale } from '@/lib/shared/i18n'

export const articleLanguagesKey = (articleId: string) =>
  ['help-center', 'article-languages', articleId] as const
export const translationKey = (articleId: string, locale: string) =>
  ['help-center', 'article-translation', articleId, locale] as const
/**
 * The editor's actions on one language of an article: each runs a server
 * function, then refreshes the language bar, the translation and the list.
 */
export function useLanguageActions(articleId: string, locale: SupportedLocale) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: articleLanguagesKey(articleId) }),
      queryClient.invalidateQueries({ queryKey: translationKey(articleId, locale) }),
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.articleLists() }),
      queryClient.invalidateQueries({
        queryKey: ['help-center', 'article-translation-changes', articleId, locale],
      }),
    ])
  }, [queryClient, articleId, locale])
  const run = useCallback(
    async (name: string, action: () => Promise<unknown>, failure: string) => {
      setBusy(name)
      setError(null)
      setNotice(null)
      try {
        await action()
        await refresh()
      } catch (err) {
        setError(errorText(err, failure))
      } finally {
        setBusy(null)
      }
    },
    [refresh]
  )
  const askAi = useCallback(
    () =>
      run(
        'ai',
        async () => {
          const outcome = await requestArticleAiTranslationFn({ data: { articleId, locale } })
          if (outcome.kind === 'paused') {
            setNotice('AI usage for this period is used up. Try again when it renews.')
          } else if (outcome.kind === 'skipped' && outcome.reason === 'unavailable') {
            setNotice('AI translation is not available on this workspace.')
          } else if (outcome.kind === 'skipped' && outcome.reason === 'failed') {
            setNotice('AI could not translate this article. Try again later.')
          }
        },
        'Could not translate with AI'
      ),
    [run, articleId, locale]
  )
  return { busy, error, notice, run, askAi, refresh }
}

export type LanguageActions = ReturnType<typeof useLanguageActions>
