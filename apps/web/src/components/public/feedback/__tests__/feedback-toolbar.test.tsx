// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { FeedbackToolbar } from '../feedback-toolbar'

function renderToolbar(props: { currentSearch?: string; onSearchChange?: (s: string) => void }) {
  const onSearchChange = props.onSearchChange ?? vi.fn()
  render(
    <IntlProvider locale="en">
      <FeedbackToolbar
        currentSort="trending"
        onSortChange={vi.fn()}
        currentSearch={props.currentSearch}
        onSearchChange={onSearchChange}
      />
    </IntlProvider>
  )
  return { onSearchChange }
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

  it('shows no clear button while the field is empty', () => {
    renderToolbar({})
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })
})
