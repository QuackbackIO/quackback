// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AskComposer, type AskComposerProps } from '../ask-composer'

afterEach(cleanup)

function mount(overrides: Partial<AskComposerProps> = {}) {
  const props: AskComposerProps = {
    query: 'messenger',
    onQueryChange: vi.fn(),
    onNavigate: vi.fn(),
    results: [{ id: 'messenger', title: 'Messenger', href: '/admin/settings/widget' }],
    ...overrides,
  }
  render(
    <IntlProvider locale="en">
      <AskComposer {...props} />
    </IntlProvider>
  )
  return props
}

describe('the separate search palette', () => {
  it('focuses the accessible search input when mounted', () => {
    mount()
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Search Quackback' }))
  })

  it('shows local Jump to results while entity search is loading', () => {
    mount({ loading: true })
    expect(screen.getByRole('option', { name: 'Messenger' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Ask Copilot/ })).toBeNull()
  })

  it('navigates to a chosen destination with the keyboard', () => {
    const props = mount()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith('/admin/settings/widget')
  })

  it('navigates to the selected result rather than always the first', () => {
    const props = mount({
      results: [
        { id: 'messenger', title: 'Messenger', href: '/admin/settings/widget' },
        { id: 'branding', title: 'Branding', href: '/admin/settings/theme' },
      ],
    })
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith('/admin/settings/theme')
  })

  it('does nothing with free text without a matching destination', () => {
    const props = mount({ query: 'Write an article for me', results: [] })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(props.onNavigate).not.toHaveBeenCalled()
    expect(screen.queryByText(/Ask Copilot/)).toBeNull()
    expect(screen.getByText('No results')).toBeTruthy()
  })

  it('hands changed text to entity search', () => {
    const props = mount()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'office hours' } })
    expect(props.onQueryChange).toHaveBeenCalledExactlyOnceWith('office hours')
  })
})
