// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { TestCustomerFrame } from '../test-customer-frame'

function setup(getToken: () => Promise<string | null>) {
  const onStatusChange = vi.fn()
  const onEvent = vi.fn()
  const onClose = vi.fn()
  render(
    <TestCustomerFrame
      getToken={getToken}
      open={{ view: 'chat', body: 'Hi! Is anyone there?' }}
      onEvent={onEvent}
      onClose={onClose}
      onStatusChange={onStatusChange}
      title="Messenger as a test customer"
    />
  )
  const frame = screen.getByTitle('Messenger as a test customer') as HTMLIFrameElement
  const child = frame.contentWindow!
  const postMessage = vi.spyOn(child, 'postMessage').mockImplementation(() => {})
  const fromFrame = (data: unknown, source: Window = child, origin = window.location.origin) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, source, origin }))
    })
  return { frame, postMessage, fromFrame, onStatusChange, onEvent, onClose }
}

describe('TestCustomerFrame', () => {
  it('loads the widget in test mode with no token in its URL', () => {
    const { frame } = setup(async () => 'customer-abc')
    expect(frame.getAttribute('src')).toBe('/widget?test=1')
  })

  it('hands its own frame a token on ready, then opens chat with the draft', async () => {
    const { postMessage, fromFrame, onStatusChange } = setup(async () => 'customer-abc')
    fromFrame({ type: 'quackback:ready' })
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'quackback:test-token', data: 'customer-abc' },
        window.location.origin
      )
    )
    fromFrame({ type: 'quackback:test-session', success: true })
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: 'quackback:open', data: { view: 'chat', body: 'Hi! Is anyone there?' } },
      window.location.origin
    )
    expect(onStatusChange).toHaveBeenLastCalledWith('ready')
  })

  it('passes the widget events through to the host', () => {
    const { fromFrame, onEvent } = setup(async () => 'customer-abc')
    fromFrame({ type: 'quackback:event', name: 'post:created', payload: { id: 'post_1' } })
    expect(onEvent).toHaveBeenCalledWith('post:created', { id: 'post_1' })
  })

  it('closes its host when Escape is pressed inside the frame', () => {
    const { fromFrame, onClose } = setup(async () => 'customer-abc')
    fromFrame({ type: 'quackback:close' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores a close request from any other window or origin', () => {
    const { fromFrame, onClose, frame } = setup(async () => 'customer-abc')
    fromFrame({ type: 'quackback:close' }, window)
    fromFrame({ type: 'quackback:close' }, frame.contentWindow!, 'https://elsewhere.example.com')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores messages from any other window or origin', async () => {
    const getToken = vi.fn(async () => 'customer-abc')
    const { fromFrame, frame } = setup(getToken)
    fromFrame({ type: 'quackback:ready' }, window)
    fromFrame({ type: 'quackback:ready' }, frame.contentWindow!, 'https://elsewhere.example.com')
    await new Promise((r) => setTimeout(r, 0))
    expect(getToken).not.toHaveBeenCalled()
  })

  it('reports expired when no token is available or the exchange fails', async () => {
    const { fromFrame, onStatusChange, postMessage } = setup(async () => null)
    fromFrame({ type: 'quackback:ready' })
    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith('expired'))
    expect(postMessage).not.toHaveBeenCalled()
    fromFrame({ type: 'quackback:test-session', success: false })
    expect(onStatusChange).toHaveBeenLastCalledWith('expired')
  })

  it('consumes a phone token once when the same document announces ready twice while minting', async () => {
    let resolveToken!: (value: string) => void
    const pending = new Promise<string>((resolve) => {
      resolveToken = resolve
    })
    const getToken = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(null)
    const { fromFrame, postMessage, onStatusChange } = setup(getToken)
    fromFrame({ type: 'quackback:ready', documentId: 'document-1' })
    fromFrame({ type: 'quackback:ready', documentId: 'document-1' })
    expect(getToken).toHaveBeenCalledTimes(1)
    await act(async () => resolveToken('customer-phone'))
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:test-token', data: 'customer-phone', documentId: 'document-1' },
      window.location.origin
    )
    expect(onStatusChange).not.toHaveBeenCalledWith('expired')
  })

  it('keeps an established phone session when its current document repeats ready or session acknowledgements', async () => {
    const getToken = vi.fn().mockResolvedValueOnce('customer-phone').mockResolvedValue(null)
    const { fromFrame, postMessage, onStatusChange } = setup(getToken)
    fromFrame({ type: 'quackback:ready', documentId: 'document-1' })
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    fromFrame({ type: 'quackback:test-session', success: true, documentId: 'document-1' })
    fromFrame({ type: 'quackback:ready', documentId: 'document-1' })
    fromFrame({ type: 'quackback:test-session', success: true, documentId: 'document-1' })
    await act(async () => {})
    expect(getToken).toHaveBeenCalledTimes(1)
    expect(
      postMessage.mock.calls.filter(([message]) => message.type === 'quackback:open')
    ).toHaveLength(1)
    expect(onStatusChange).toHaveBeenLastCalledWith('ready')
    expect(onStatusChange).not.toHaveBeenCalledWith('expired')
  })

  it('mints a fresh token after an actual frame document reload and rejects late replies from the previous document', async () => {
    let resolveFirst!: (value: string) => void
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve
    })
    const getToken = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce('customer-new-document')
    const { fromFrame, postMessage, onStatusChange } = setup(getToken)
    fromFrame({ type: 'quackback:ready', documentId: 'document-before-reload' })
    fromFrame({ type: 'quackback:ready', documentId: 'document-after-reload' })
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'quackback:test-token',
          data: 'customer-new-document',
          documentId: 'document-after-reload',
        },
        window.location.origin
      )
    )
    await act(async () => resolveFirst('customer-old-document'))
    expect(postMessage).toHaveBeenCalledTimes(1)
    fromFrame({
      type: 'quackback:test-session',
      success: false,
      documentId: 'document-before-reload',
    })
    expect(onStatusChange).not.toHaveBeenCalledWith('expired')
    fromFrame({
      type: 'quackback:test-session',
      success: true,
      documentId: 'document-after-reload',
    })
    expect(onStatusChange).toHaveBeenLastCalledWith('ready')
    expect(getToken).toHaveBeenCalledTimes(2)
  })
})
