// @vitest-environment happy-dom
/**
 * The article editor: an emptied description is saved as cleared, an article
 * id that matches nothing says so instead of loading for ever, and the
 * language bar switches between the article's languages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { UseFormReturn } from 'react-hook-form'
import type { ArticleId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'

const mocks = vi.hoisted(() => ({
  getArticleFn: vi.fn(),
  updateMutate: vi.fn(),
  getArticleLanguagesFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/help-center', () => ({
  getArticleFn: (...args: unknown[]) => mocks.getArticleFn(...args),
}))
vi.mock('@/lib/server/functions/admin', () => ({
  listSegmentsFn: vi.fn(async () => []),
}))
vi.mock('@/lib/client/mutations/help-center', () => ({
  useUpdateArticle: () => ({ mutate: mocks.updateMutate, isPending: false, isError: false }),
  usePublishArticle: () => ({ mutate: vi.fn(), isPending: false }),
  useUnpublishArticle: () => ({ mutate: vi.fn(), isPending: false }),
}))
// The rich editor and the sidebars are not under test; the description field is.
vi.mock('../help-center-form-fields', () => ({
  HelpCenterFormFields: ({ form }: { form: UseFormReturn<{ description?: string }> }) => (
    <input aria-label="Page description" {...form.register('description')} />
  ),
}))
vi.mock('../help-center-metadata-sidebar', () => ({
  HelpCenterMetadataSidebar: () => null,
  HelpCenterMetadataSidebarContent: () => null,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/settings">{children}</a>,
}))
vi.mock('@/lib/server/functions/help-center-article-languages', () => ({
  getArticleLanguagesFn: (...args: unknown[]) => mocks.getArticleLanguagesFn(...args),
}))
vi.mock('../article-translation-pane', () => ({
  articleLanguagesKey: (id: string) => ['help-center', 'article-languages', id],
  ArticleTranslationPane: ({
    entry,
    onDirtyChange,
  }: {
    entry: { locale: string }
    onDirtyChange?: (dirty: boolean) => void
  }) => (
    <div>
      Editing {entry.locale}
      <button type="button" onClick={() => onDirtyChange?.(true)}>
        Type in {entry.locale}
      </button>
    </div>
  ),
}))
vi.mock('../article-feedback-reasons-dialog', () => ({
  ArticleFeedbackReasonsDialog: () => null,
}))

import { ArticleModalContent } from '../article-modal'

const ARTICLE_ID = 'article_01h455vb4pex5vsknk084sn02q' as ArticleId

function renderModal(onClose: () => void = () => {}) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" defaultLocale="en">
        <ArticleModalContent articleId={ARTICLE_ID} onClose={onClose} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

const entry = (locale: string, extra: Record<string, unknown> = {}) => ({
  locale,
  status: 'untranslated',
  title: null,
  updatedAt: null,
  needsUpdate: false,
  pendingUpdate: null,
  draftCheck: null,
  autoTranslatePaused: false,
  ...extra,
})

const ARTICLE = {
  id: ARTICLE_ID,
  title: 'Refunds',
  description: 'Old summary',
  content: 'Body',
  contentJson: null,
  categoryId: 'kb_category_1',
  segmentIds: [],
  publishedAt: null,
  notHelpfulCount: 0,
  category: { slug: 'billing' },
  slug: 'refunds',
  author: null,
  locale: 'en',
}

beforeEach(() => {
  mocks.getArticleFn.mockReset()
  mocks.updateMutate.mockReset()
  mocks.getArticleLanguagesFn.mockReset()
  mocks.getArticleLanguagesFn.mockResolvedValue({
    ownLocale: 'en',
    mainLocale: 'en',
    aiAvailable: false,
    autoTranslate: false,
    languages: [],
  })
})
afterEach(cleanup)

describe('ArticleModalContent', () => {
  it('saves an emptied description as cleared, not as unchanged', async () => {
    mocks.getArticleFn.mockResolvedValue({
      id: ARTICLE_ID,
      title: 'Refunds',
      description: 'Old summary',
      content: 'Body',
      contentJson: null,
      categoryId: 'kb_category_1',
      segmentIds: [],
      publishedAt: null,
      notHelpfulCount: 0,
      category: { slug: 'billing' },
      slug: 'refunds',
      author: null,
    })
    renderModal()
    const description = (await screen.findByLabelText('Page description')) as HTMLInputElement
    await waitFor(() => expect(description.value).toBe('Old summary'))
    fireEvent.change(description, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.updateMutate).toHaveBeenCalled())
    expect(mocks.updateMutate.mock.calls[0][0]).toMatchObject({ description: '' })
  })

  it('shows each language with its state, and switches to a language on click', async () => {
    mocks.getArticleFn.mockResolvedValue(ARTICLE)
    mocks.getArticleLanguagesFn.mockResolvedValue({
      ownLocale: 'en',
      mainLocale: 'en',
      aiAvailable: true,
      autoTranslate: false,
      languages: [
        entry('fr', { status: 'published' }),
        entry('de', { status: 'published', needsUpdate: true }),
        entry('es'),
      ],
    })
    renderModal()
    const bar = await screen.findByRole('tablist', { name: 'Article languages' })
    const tabs = bar.querySelectorAll('[role="tab"]')
    expect([...tabs].map((t) => t.textContent)).toEqual([
      'EnglishMain',
      'FrançaisPublished',
      'DeutschNeeds update',
      'EspañolNot translated',
    ])
    expect(screen.queryByText('Editing de')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Deutsch/ }))
    expect(await screen.findByText('Editing de')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Deutsch/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('saving the article stays open on a language whose edits are not saved yet', async () => {
    mocks.getArticleFn.mockResolvedValue(ARTICLE)
    mocks.getArticleLanguagesFn.mockResolvedValue({
      ownLocale: 'en',
      mainLocale: 'en',
      aiAvailable: false,
      autoTranslate: false,
      languages: [entry('de', { status: 'published' }), entry('fr', { status: 'published' })],
    })
    mocks.updateMutate.mockImplementation((_input, opts: { onSuccess: () => void }) =>
      opts.onSuccess()
    )
    const onClose = vi.fn()
    renderModal(onClose)

    fireEvent.click(await screen.findByRole('tab', { name: /Deutsch/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Type in de' }))
    fireEvent.click(screen.getByRole('tab', { name: /English/ }))
    fireEvent.change(screen.getByLabelText('Page description'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.updateMutate).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /Deutsch/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('saving the article closes the editor when no other language has unsaved edits', async () => {
    mocks.getArticleFn.mockResolvedValue(ARTICLE)
    mocks.updateMutate.mockImplementation((_input, opts: { onSuccess: () => void }) =>
      opts.onSuccess()
    )
    const onClose = vi.fn()
    renderModal(onClose)
    fireEvent.change(await screen.findByLabelText('Page description'), {
      target: { value: 'New' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows no language bar when the help center has one language', async () => {
    mocks.getArticleFn.mockResolvedValue(ARTICLE)
    renderModal()
    await screen.findByLabelText('Page description')
    await waitFor(() => expect(mocks.getArticleLanguagesFn).toHaveBeenCalled())
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('says the article was not found when the id matches nothing', async () => {
    mocks.getArticleFn.mockRejectedValue(new NotFoundError('ARTICLE_NOT_FOUND', 'not found'))
    const { container } = renderModal()
    expect(await screen.findByText(/no longer exists/i, {}, { timeout: 3000 })).toBeTruthy()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })
})
