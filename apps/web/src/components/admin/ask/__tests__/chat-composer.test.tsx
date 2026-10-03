// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerProps } from '../chat-composer'

afterEach(cleanup)

function mount(overrides: Partial<ChatComposerProps> = {}) {
  const props: ChatComposerProps = {
    query: 'Find our refund policy\nand draft a reply',
    onQueryChange: vi.fn(),
    canAsk: true,
    busy: false,
    onAsk: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  }
  render(
    <IntlProvider locale="en">
      <ChatComposer {...props} />
    </IntlProvider>
  )
  return props
}

describe('the focused chat composer', () => {
  it('focuses an accessible multiline question field', () => {
    mount()
    const input = screen.getByRole('textbox', { name: 'Ask or tell Quackback anything' })
    expect(input.tagName).toBe('TEXTAREA')
    expect(document.activeElement).toBe(input)
  })

  it('sends the entire multiline question once on Enter', () => {
    const props = mount()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(props.onAsk).toHaveBeenCalledExactlyOnceWith('Find our refund policy\nand draft a reply')
  })

  it('lets Shift+Enter create a new line without sending', () => {
    const props = mount()
    const allowed = fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      shiftKey: true,
    })
    expect(allowed).toBe(true)
    expect(props.onAsk).not.toHaveBeenCalled()
  })

  it('does not send while an input method is composing', () => {
    const props = mount()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true })
    expect(props.onAsk).not.toHaveBeenCalled()
  })

  it('keeps unsent text editable while a response streams and offers Stop', () => {
    const props = mount({ busy: true })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A follow-up' } })
    expect(props.onQueryChange).toHaveBeenCalledWith('A follow-up')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(props.onAsk).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(props.onStop).toHaveBeenCalledOnce()
  })

  it.each([
    { query: '  ', canAsk: true },
    { query: 'Find our refund policy', canAsk: false },
  ])('never sends an empty question or a question without permission: %j', (input) => {
    const props = mount(input)
    expect(screen.getByRole('button', { name: 'Ask Copilot' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(props.onAsk).not.toHaveBeenCalled()
  })
})
