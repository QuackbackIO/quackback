// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { PortalWordsIntl } from '@/lib/client/hooks/use-intl-setup'
import { FeedbackToolbar } from '../feedback-toolbar'
import { createFeedHandoff, FeedHandoffContext, type FeedHandoff } from '../feed-input-handoff'

function renderToolbar(props: { currentSearch?: string; onSearchChange?: (s: string) => void }) {
  const onSearchChange = props.onSearchChange ?? vi.fn()
  const ui = (currentSearch: string | undefined) => (
    <IntlProvider locale="en">
      <PortalWordsIntl>
        <FeedbackToolbar
          currentSort="trending"
          onSortChange={vi.fn()}
          currentSearch={currentSearch}
          onSearchChange={onSearchChange}
        />
      </PortalWordsIntl>
    </IntlProvider>
  )
  const { rerender } = render(ui(props.currentSearch))
  /** The URL catching up, as the router does after onSearchChange. */
  const setCurrentSearch = (value: string | undefined) => rerender(ui(value))
  return { onSearchChange, setCurrentSearch }
}

describe('FeedbackToolbar search', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the current search in a visible field', () => {
    renderToolbar({ currentSearch: 'widget' })
    expect(screen.getByRole('searchbox', { name: 'Search ideas' })).toHaveProperty(
      'value',
      'widget'
    )
  })

  it('applies typing after a pause', () => {
    const { onSearchChange } = renderToolbar({})
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'dark mode' } })
    expect(onSearchChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(400))
    expect(onSearchChange).toHaveBeenCalledWith('dark mode')
  })

  describe('from the loading feed', () => {
    const toolbar = (
      handoff: FeedHandoff,
      handOffSearch: boolean,
      onSearchChange: (s: string) => void
    ) => (
      <IntlProvider locale="en">
        <PortalWordsIntl>
          <FeedHandoffContext.Provider value={handoff}>
            <FeedbackToolbar
              currentSort="trending"
              onSortChange={vi.fn()}
              onSearchChange={onSearchChange}
              handOffSearch={handOffSearch}
            />
          </FeedHandoffContext.Provider>
        </PortalWordsIntl>
      </IntlProvider>
    )
    function typeWhileLoading(handoff: FeedHandoff): ReturnType<typeof vi.fn> {
      const loading = vi.fn()
      const view = render(toolbar(handoff, true, loading))
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zap' } })
      view.unmount()
      return loading
    }

    it('carries a search still waiting on its pause to the loaded feed', () => {
      const handoff = createFeedHandoff()
      expect(typeWhileLoading(handoff)).not.toHaveBeenCalled()

      const loaded = vi.fn()
      render(toolbar(handoff, false, loaded))
      expect(screen.getByRole('searchbox')).toHaveProperty('value', 'zap')
      act(() => vi.advanceTimersByTime(400))
      expect(loaded).toHaveBeenCalledWith('zap')
    })

    it('does not carry it into the feed of a later visit', () => {
      typeWhileLoading(createFeedHandoff())

      const loaded = vi.fn()
      render(toolbar(createFeedHandoff(), false, loaded))
      expect(screen.getByRole('searchbox')).toHaveProperty('value', '')
      act(() => vi.advanceTimersByTime(400))
      expect(loaded).not.toHaveBeenCalled()
    })
  })

  it('clears the search', () => {
    const { onSearchChange } = renderToolbar({ currentSearch: 'widget' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onSearchChange).toHaveBeenCalledWith('')
  })

  it('keeps typing that happens while the search is being applied', () => {
    const { onSearchChange, setCurrentSearch } = renderToolbar({})
    const field = screen.getByRole('searchbox')
    fireEvent.change(field, { target: { value: 'dark' } })
    act(() => vi.advanceTimersByTime(400))
    expect(onSearchChange).toHaveBeenCalledWith('dark')
    fireEvent.change(field, { target: { value: 'dark mo' } })
    setCurrentSearch('dark')
    expect(field).toHaveProperty('value', 'dark mo')
  })

  it('follows a search changed from elsewhere, like Clear all or Back', () => {
    const { setCurrentSearch } = renderToolbar({ currentSearch: 'dark' })
    setCurrentSearch('widget')
    expect(screen.getByRole('searchbox')).toHaveProperty('value', 'widget')
  })

  it('does not search for spaces alone, and trims the query', () => {
    const { onSearchChange } = renderToolbar({})
    const field = screen.getByRole('searchbox')
    fireEvent.change(field, { target: { value: '   ' } })
    act(() => vi.advanceTimersByTime(400))
    expect(onSearchChange).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: ' dark mode ' } })
    act(() => vi.advanceTimersByTime(400))
    expect(onSearchChange).toHaveBeenCalledWith('dark mode')
  })

  it('leaves a URL search with stray spaces alone until the viewer types', () => {
    const { onSearchChange } = renderToolbar({ currentSearch: 'dark ' })
    act(() => vi.advanceTimersByTime(400))
    expect(onSearchChange).not.toHaveBeenCalled()
  })

  it('shows no clear button while the field is empty', () => {
    renderToolbar({})
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })
})

describe('FeedbackToolbar sort', () => {
  function renderSort(currentSort: 'trending' | 'relevance', currentSearch?: string) {
    const onSortChange = vi.fn()
    render(
      <IntlProvider locale="en">
        <PortalWordsIntl>
          <FeedbackToolbar
            currentSort={currentSort}
            onSortChange={onSortChange}
            currentSearch={currentSearch}
            onSearchChange={vi.fn()}
          />
        </PortalWordsIntl>
      </IntlProvider>
    )
    return { onSortChange }
  }

  it('offers Best match only while searching', () => {
    renderSort('trending')
    expect(screen.queryByRole('button', { name: 'Best match' })).not.toBeInTheDocument()
    cleanup()
    const { onSortChange } = renderSort('relevance', 'zap')
    expect(screen.getByRole('button', { name: 'Best match' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Top' }))
    expect(onSortChange).toHaveBeenCalledWith('top')
  })

  it('shows Trending as the order when best match has no search to rank', () => {
    renderSort('relevance')
    expect(screen.getByRole('button', { name: 'Trending' })).toHaveAttribute('aria-pressed', 'true')
  })
})
