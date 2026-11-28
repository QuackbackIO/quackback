// @vitest-environment happy-dom
/**
 * The Language card names the main language in both visitor choices, and a
 * change of main language asks first, with the counts the server gives: the
 * articles and collections swapped with their versions in the new language,
 * relabelled, or left in their own language.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const server = vi.hoisted(() => ({
  preview: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/server/functions/language-settings', () => ({
  previewMainLanguageChangeFn: server.preview,
  updateLanguageSettingsFn: server.update,
}))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ languageConfig: { mainLanguage: 'en', visitorLanguage: 'own' } }),
}))
// The select's options open in a portal that happy-dom cannot lay out; a
// plain select stands in for it.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: ReactNode
  }) => (
    <select
      aria-label="Main language"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

const { LanguageCard } = await import('../language-card')

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en">
        <LanguageCard />
      </IntlProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  server.preview.mockReset()
  server.update.mockReset()
})

describe('LanguageCard', () => {
  it('names the main language in the choices, and each language in its own name too', () => {
    renderCard()
    expect(screen.getByText('English for everyone')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'German (Deutsch)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
  })

  it('says what a new main language relabels, and changes it only once confirmed', async () => {
    server.preview.mockResolvedValue({
      swappedArticles: 0,
      swappedCollections: 0,
      relabelledArticles: 24,
      relabelledCollections: 5,
      keptArticles: 0,
      keptCollections: 0,
    })
    server.update.mockResolvedValue({ mainLanguage: 'de', visitorLanguage: 'own' })
    renderCard()

    fireEvent.change(screen.getByLabelText('Main language'), { target: { value: 'de' } })

    expect(
      await screen.findByText(
        'Your 24 articles and 5 collections will be marked as German. Nothing is rewritten or translated.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Switch your main language to German?')).toBeInTheDocument()
    expect(server.preview).toHaveBeenCalledWith({ data: { mainLanguage: 'de' } })
    expect(server.update).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to German' }))
    await waitFor(() =>
      expect(server.update).toHaveBeenCalledWith({ data: { mainLanguage: 'de' } })
    )
    expect(await screen.findByText('German for everyone')).toBeInTheDocument()
  })

  it('says which articles and collections swap in and which stay', async () => {
    server.preview.mockResolvedValue({
      swappedArticles: 1,
      swappedCollections: 2,
      relabelledArticles: 0,
      relabelledCollections: 0,
      keptArticles: 3,
      keptCollections: 1,
    })
    renderCard()

    fireEvent.change(screen.getByLabelText('Main language'), { target: { value: 'fr' } })

    expect(
      await screen.findByText(
        '1 article and 2 collections have a French version, which becomes their main text. Their current text becomes a translation, so nothing is lost.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('3 articles have no published French version yet and stay as they are.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('1 collection has no French name yet and stays as it is.')
    ).toBeInTheDocument()
  })

  it('says which articles swap in and which are relabelled when both happen', async () => {
    server.preview.mockResolvedValue({
      swappedArticles: 4,
      swappedCollections: 1,
      relabelledArticles: 2,
      relabelledCollections: 1,
      keptArticles: 0,
      keptCollections: 0,
    })
    renderCard()

    fireEvent.change(screen.getByLabelText('Main language'), { target: { value: 'de' } })

    expect(
      await screen.findByText(
        '4 articles and 1 collection have a German version, which becomes their main text. Their current text becomes a translation, so nothing is lost.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '2 articles and 1 collection with no German version will be marked as German. Nothing is rewritten or translated.'
      )
    ).toBeInTheDocument()
  })

  it('names only the kinds that change, never "0 collections"', async () => {
    server.preview.mockResolvedValue({
      swappedArticles: 3,
      swappedCollections: 0,
      relabelledArticles: 0,
      relabelledCollections: 2,
      keptArticles: 0,
      keptCollections: 0,
    })
    renderCard()

    fireEvent.change(screen.getByLabelText('Main language'), { target: { value: 'de' } })

    expect(
      await screen.findByText(
        '3 articles have a German version, which becomes their main text. Their current text becomes a translation, so nothing is lost.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '2 collections with no German version will be marked as German. Nothing is rewritten or translated.'
      )
    ).toBeInTheDocument()
    expect(screen.getByTestId('main-language-confirm')).not.toHaveTextContent(/\b0 /)
  })

  it('names one article alone when only it is relabelled, and one collection alone when only it swaps', async () => {
    server.preview.mockResolvedValueOnce({
      swappedArticles: 0,
      swappedCollections: 0,
      relabelledArticles: 1,
      relabelledCollections: 0,
      keptArticles: 0,
      keptCollections: 0,
    })
    renderCard()

    fireEvent.change(screen.getByLabelText('Main language'), { target: { value: 'fr' } })

    expect(
      await screen.findByText(
        'Your 1 article will be marked as French. Nothing is rewritten or translated.'
      )
    ).toBeInTheDocument()
    cleanup()

    server.preview.mockResolvedValueOnce({
      swappedArticles: 0,
      swappedCollections: 1,
      relabelledArticles: 0,
      relabelledCollections: 0,
      keptArticles: 0,
      keptCollections: 0,
    })
    renderCard()

    fireEvent.change(screen.getByLabelText('Main language'), { target: { value: 'fr' } })

    expect(
      await screen.findByText(
        '1 collection has a French version, which becomes its main text. Its current text becomes a translation, so nothing is lost.'
      )
    ).toBeInTheDocument()
  })

  it('says when the counts could not be read, and tries again on request', async () => {
    server.preview.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      swappedArticles: 0,
      swappedCollections: 0,
      relabelledArticles: 3,
      relabelledCollections: 1,
      keptArticles: 0,
      keptCollections: 0,
    })
    renderCard()

    fireEvent.change(screen.getByLabelText('Main language'), { target: { value: 'de' } })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not check what this changes.'
    )
    expect(screen.getByRole('button', { name: 'Switch to German' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByText(
        'Your 3 articles and 1 collection will be marked as German. Nothing is rewritten or translated.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to German' })).toBeEnabled()
  })
})
