// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { KbArticleId } from '@quackback/ids'
import de from '@/locales/de.json'

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
  listArticleTranslationsFn: vi.fn(async () => []),
  upsertArticleTranslationFn: vi.fn(),
  setArticleTranslationStatusFn: vi.fn(),
  deleteArticleTranslationFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/help-center', () => ({
  getArticleFn: vi.fn(async () => ({ title: 'Refunds', description: null, content: 'x' })),
}))

import { ArticleTranslationsDialog } from '../article-translations-dialog'

afterEach(cleanup)

function renderDialog(locale: string, messages: Record<string, string>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings', 'helpCenterConfig'], {
    locales: { default: 'en', additional: ['de'] },
  })
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
    expect(await screen.findByText('Pausiert: KI-Budget aufgebraucht')).toBeTruthy()
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
