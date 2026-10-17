// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { FeedbackToolbar } from '../feedback-toolbar'

function renderToolbar(props: { currentSearch?: string; onSearchChange?: (s: string) => void }) {
  const onSearchChange = props.onSearchChange ?? vi.fn()
  const ui = (currentSearch: string | undefined) => (
    <IntlProvider locale="en">
      <FeedbackToolbar
        currentSort="trending"
        onSortChange={vi.fn()}
        currentSearch={currentSearch}
        onSearchChange={onSearchChange}
      />
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
