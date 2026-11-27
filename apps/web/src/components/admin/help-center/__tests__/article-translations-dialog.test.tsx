// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { KbArticleId } from '@quackback/ids'
import de from '@/locales/de.json'
import { upsertArticleTranslationFn } from '@/lib/server/functions/help-center-translations'

const statuses = vi.hoisted(() => ({
  rows: [] as Array<{
    locale: string
    status: 'untranslated' | 'draft' | 'published'
    updatedAt: Date | null
    autoTranslatePaused: boolean
  }>,
}))

vi.mock('@/lib/server/functions/help-center-translations', () => ({
  getArticleTranslationStatusesFn: vi.fn(async () => statuses.rows),
  listArticleTranslationsFn: vi.fn(async () => [
    { locale: 'de', title: 'Rückerstattung', description: null, content: 'Text' },
  ]),
  upsertArticleTranslationFn: vi.fn(),
  setArticleTranslationStatusFn: vi.fn(),
  deleteArticleTranslationFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/help-center', () => ({
  getArticleFn: vi.fn(async () => ({ title: 'Refunds', description: null, content: 'x' })),
}))

import { ArticleTranslationsDialog } from '../article-translations-dialog'

afterEach(cleanup)

function renderDialog(
  locale: string,
  messages: Record<string, string>,
  languages: { default: string; additional: string[] } = { default: 'en', additional: ['de'] }
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings', 'helpCenterConfig'], { locales: languages })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale={locale} messages={messages}>
        <ArticleTranslationsDialog
          articleId={'article_1' as KbArticleId}
          open
          onOpenChange={() => {}}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('ArticleTranslationsDialog auto-translate pause', () => {
  it('says when auto-translate is waiting for AI allowance, in the viewer language', async () => {
    statuses.rows = [
      { locale: 'de', status: 'untranslated', updatedAt: null, autoTranslatePaused: true },
    ]
    renderDialog('de', de)
    expect(
      await screen.findByText(
        'Pausiert: KI-Nutzung für diesen Zeitraum aufgebraucht. Upgrade deinen Tarif für mehr.'
      )
    ).toBeTruthy()
  })

  it('stays quiet when nothing is paused', async () => {
    statuses.rows = [
      { locale: 'de', status: 'untranslated', updatedAt: null, autoTranslatePaused: false },
    ]
    renderDialog('en', {})
    expect(await screen.findByText('Untranslated')).toBeTruthy()
    expect(screen.queryByText(/Paused/)).toBeNull()
  })
})

describe('ArticleTranslationsDialog languages', () => {
  it('offers the languages the server lists, so an article left in an old main language gets the main language and not its own', async () => {
    // Main language German; the article is still in English, now an extra language.
    statuses.rows = [
      { locale: 'de', status: 'draft', updatedAt: null, autoTranslatePaused: false },
      { locale: 'fr', status: 'untranslated', updatedAt: null, autoTranslatePaused: false },
    ]
    renderDialog('en', {}, { default: 'de', additional: ['en', 'fr'] })

    expect(await screen.findByText('Deutsch')).toBeTruthy()
    expect(screen.queryByText('English')).toBeNull()
  })
})

describe('ArticleTranslationsDialog save draft', () => {
  it('a published translation saved as a draft is a draft afterwards', async () => {
    statuses.rows = [
      { locale: 'de', status: 'published', updatedAt: null, autoTranslatePaused: false },
    ]
    renderDialog('en', {})
    expect(await screen.findByRole('button', { name: 'Unpublish' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeTruthy()
    expect(upsertArticleTranslationFn).toHaveBeenCalledTimes(1)
  })
})
