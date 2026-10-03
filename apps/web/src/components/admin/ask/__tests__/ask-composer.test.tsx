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
    canAsk: true,
    onAsk: vi.fn(),
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

describe('the shared Ask composer', () => {
  it('shows local Jump to results while entity search is still loading', () => {
    mount({ loading: true })
    expect(screen.getByRole('option', { name: 'Messenger' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Ask Copilot messenger' })).toBeTruthy()
  })

  it('asks free text on Enter and never navigates without choosing a destination', () => {
    const props = mount()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(props.onAsk).toHaveBeenCalledWith('messenger')
    expect(props.onNavigate).not.toHaveBeenCalled()
  })

  it('chooses a destination with the keyboard', () => {
    const props = mount()
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onNavigate).toHaveBeenCalledWith('/admin/settings/widget')
    expect(props.onAsk).not.toHaveBeenCalled()
  })

  it('keeps navigation available with AI off and omits the Ask row', () => {
    const props = mount({ canAsk: false })
    expect(screen.queryByRole('option', { name: /Ask Copilot/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'Messenger' }))
    expect(props.onNavigate).toHaveBeenCalledWith('/admin/settings/widget')
    expect(props.onAsk).not.toHaveBeenCalled()
  })

  it('never asks an empty query', () => {
    const props = mount({ query: '  ', results: [] })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(props.onAsk).not.toHaveBeenCalled()
    expect(screen.queryByRole('option', { name: /Ask Copilot/ })).toBeNull()
  })

  it('hands changed text to instant search without asking a model', () => {
    const props = mount()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'office hours' } })
    expect(props.onQueryChange).toHaveBeenCalledWith('office hours')
    expect(props.onAsk).not.toHaveBeenCalled()
  })
})
