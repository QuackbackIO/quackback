// @vitest-environment happy-dom
/**
 * One extra language of an article in the editor: the missing-language
 * screen, and the strips for a translation that needs an update, has an AI
 * update ready, or has one that needs a person.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UseFormReturn } from 'react-hook-form'

const fns = vi.hoisted(() => ({
  getArticleTranslationFn: vi.fn(),
  markArticleTranslationCurrentFn: vi.fn(async () => ({ success: true })),
  publishArticleTranslationUpdateFn: vi.fn(async () => ({ success: true })),
  discardArticleTranslationUpdateFn: vi.fn(async () => ({ success: true })),
  requestArticleAiTranslationFn: vi.fn(async () => ({ kind: 'draft' })),
  getArticleTranslationChangesFn: vi.fn(),
  upsertArticleTranslationFn: vi.fn(async (_args: unknown) => ({})),
  setArticleTranslationStatusFn: vi.fn(async () => ({})),
  deleteArticleTranslationFn: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/server/functions/help-center-article-languages', () => fns)
vi.mock('@/lib/server/functions/help-center-translations', () => fns)
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/settings">{children}</a>,
}))
vi.mock('../help-center-form-fields', () => ({
  HelpCenterFormFields: ({ form }: { form: UseFormReturn<{ title: string }> }) => (
    <input aria-label="Article title" {...form.register('title')} />
  ),
}))

import { ArticleTranslationPane } from '../article-translation-pane'
import type { ArticleLanguageEntry } from '../article-languages'

const entry = (extra: Partial<ArticleLanguageEntry> = {}): ArticleLanguageEntry => ({
  locale: 'de',
  status: 'published',
  title: 'Konto einrichten',
  updatedAt: '2026-11-20T10:00:00.000Z',
  needsUpdate: false,
  pendingUpdate: null,
  draftCheck: null,
  autoTranslatePaused: false,
  ...extra,
})

const row = {
  locale: 'de',
  title: 'Konto einrichten',
  description: null,
  content: 'Öffne Einstellungen.',
  contentJson: null,
  status: 'published',
  updatedAt: '2026-11-20T10:00:00.000Z',
}

function renderPane(e: ArticleLanguageEntry, aiAvailable = true) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ArticleTranslationPane
        articleId="article_1"
        ownLocale="en"
        entry={e}
        aiAvailable={aiAvailable}
        source={{
          title: 'Set up your account',
          description: 'Name and photo',
          content: 'Open Settings.',
          contentJson: null,
        }}
        shared={{ categoryName: 'Getting started', authorName: null, audience: 'Everyone' }}
        header={null}
        onClose={() => {}}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  for (const fn of Object.values(fns)) fn.mockClear()
  fns.getArticleTranslationFn.mockResolvedValue(row)
})
afterEach(cleanup)

describe('a language with no version', () => {
  beforeEach(() => fns.getArticleTranslationFn.mockResolvedValue(null))

  it('says what readers see now and offers AI or the main text', async () => {
    renderPane(entry({ locale: 'es', status: 'untranslated', title: null, updatedAt: null }))
    expect(await screen.findByText('This article is not in Español yet')).toBeTruthy()
    expect(screen.getByText('Readers who use Español see the English article.')).toBeTruthy()
    expect(screen.getByText('The English article')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Translate with AI' }))
    await waitFor(() =>
      expect(fns.requestArticleAiTranslationFn).toHaveBeenCalledWith({
        data: { articleId: 'article_1', locale: 'es' },
      })
    )
  })

  it('does not offer AI when it is not available', async () => {
    renderPane(entry({ locale: 'es', status: 'untranslated' }), false)
    await screen.findByText('This article is not in Español yet')
    expect(screen.queryByRole('button', { name: 'Translate with AI' })).toBeNull()
  })

  it('starting from the main text opens it in the editor, saved as a new translation', async () => {
    renderPane(entry({ locale: 'es', status: 'untranslated' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start from the English text' }))
    const title = (await screen.findByLabelText('Article title')) as HTMLInputElement
    expect(title.value).toBe('Set up your account')
    fireEvent.change(title, { target: { value: 'Configura tu cuenta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(fns.upsertArticleTranslationFn).toHaveBeenCalled())
    expect(fns.upsertArticleTranslationFn.mock.calls[0][0]).toMatchObject({
      data: {
        articleId: 'article_1',
        locale: 'es',
        title: 'Configura tu cuenta',
        description: 'Name and photo',
      },
    })
  })
})

describe('an existing translation', () => {
  it('that needs an update offers show changes, AI and mark as up to date', async () => {
    renderPane(entry({ needsUpdate: true }))
    expect(
      await screen.findByText('The English article changed after this translation was made.')
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show changes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update with AI' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mark as up to date' }))
    await waitFor(() =>
      expect(fns.markArticleTranslationCurrentFn).toHaveBeenCalledWith({
        data: { articleId: 'article_1', locale: 'de' },
      })
    )
  })

  it('with an AI update ready offers publish and discard', async () => {
    renderPane(
      entry({
        needsUpdate: true,
        pendingUpdate: {
          sourceRevision: 2,
          createdAt: null,
          current: true,
          check: { ok: true, problems: [] },
        },
      })
    )
    expect(
      await screen.findByText(
        'An AI update is ready. Readers see the current text until you publish it.'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish update' }))
    await waitFor(() => expect(fns.publishArticleTranslationUpdateFn).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Mark as up to date' })).toBeNull()
  })

  it('with an AI update that failed its checks says why, and cannot publish it', async () => {
    renderPane(
      entry({
        needsUpdate: true,
        pendingUpdate: {
          sourceRevision: 2,
          createdAt: null,
          current: true,
          check: { ok: false, problems: [{ code: 'link_missing', detail: '/settings' }] },
        },
      })
    )
    expect(
      await screen.findByText('The AI update needs a person: a link is missing: /settings.')
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publish update' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(fns.discardArticleTranslationUpdateFn).toHaveBeenCalled())
  })

  it('that is current shows no strip, and its status toggles its own publish state', async () => {
    renderPane(entry())
    await screen.findByLabelText('Article title')
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Published' }))
    await waitFor(() =>
      expect(fns.setArticleTranslationStatusFn).toHaveBeenCalledWith({
        data: { articleId: 'article_1', locale: 'de', status: 'draft' },
      })
    )
  })
})
