// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { TestCustomerFrame } from '../test-customer-frame'

function setup(getToken: () => Promise<string | null>) {
  const onStatusChange = vi.fn()
  const onEvent = vi.fn()
  render(
    <TestCustomerFrame
      getToken={getToken}
      open={{ view: 'chat', body: 'Hi! Is anyone there?' }}
      onEvent={onEvent}
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
  return { frame, postMessage, fromFrame, onStatusChange, onEvent }
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
})
