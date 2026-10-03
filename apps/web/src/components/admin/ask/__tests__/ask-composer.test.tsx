// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('focuses the palette input when its deferred composer mounts', () => {
    mount({ variant: 'palette' })
    expect(document.activeElement).toBe(screen.getByRole('combobox'))
  })

  it('keeps focus unchanged when the inline Home composer mounts', () => {
    mount({ variant: 'home' })
    expect(document.activeElement).not.toBe(screen.getByRole('combobox'))
  })

  it('keeps conversation controls accessible in the Home composer footer', () => {
    const reset = vi.fn()
    mount({
      variant: 'home',
      query: '',
      footerActions: (
        <button aria-label="New conversation" onClick={reset}>
          +
        </button>
      ),
    })
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(reset).toHaveBeenCalledOnce()
  })

  it.each([true, false])(
    'lets a footer button handle Enter without submitting or navigating with AI enabled=%s',
    async (canAsk) => {
      const user = userEvent.setup()
      const reset = vi.fn()
      const props = mount({
        variant: 'home',
        canAsk,
        footerActions: <button onClick={reset}>New conversation</button>,
      })
      screen.getByRole('button', { name: 'New conversation' }).focus()
      await user.keyboard('{Enter}')
      expect(reset).toHaveBeenCalledOnce()
      expect(props.onAsk).not.toHaveBeenCalled()
      expect(props.onNavigate).not.toHaveBeenCalled()
    }
  )

  it('lets the send button submit its question exactly once with the keyboard', async () => {
    const user = userEvent.setup()
    const props = mount({ variant: 'home' })
    screen.getByRole('button', { name: 'Ask Copilot' }).focus()
    await user.keyboard('{Enter}')
    expect(props.onAsk).toHaveBeenCalledExactlyOnceWith('messenger')
    expect(props.onNavigate).not.toHaveBeenCalled()
  })

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
