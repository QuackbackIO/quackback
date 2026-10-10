// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { HOST_SHOWN_MESSAGE, useHostShown } from '../use-host-shown'

function send(data: unknown, source: MessageEventSource | null) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source }))
  })
}

// Module state outlives a test: leave the frame shown.
afterEach(() => send({ type: HOST_SHOWN_MESSAGE, shown: true }, window.parent))

it('is shown until the host page says it hides the frame, and again once it shows it', () => {
  const { result } = renderHook(() => useHostShown())
  expect(result.current).toBe(true)
  send({ type: HOST_SHOWN_MESSAGE, shown: false }, window.parent)
  expect(result.current).toBe(false)
  send({ type: HOST_SHOWN_MESSAGE, shown: true }, window.parent)
  expect(result.current).toBe(true)
})

it('remembers a hide that arrived before anything was listening', () => {
  send({ type: HOST_SHOWN_MESSAGE, shown: false }, window.parent)
  const { result } = renderHook(() => useHostShown())
  expect(result.current).toBe(false)
})

it('ignores anyone but the host page and malformed messages', () => {
  const { result } = renderHook(() => useHostShown())
  send({ type: HOST_SHOWN_MESSAGE, shown: false }, null)
  send({ type: HOST_SHOWN_MESSAGE, shown: 'no' }, window.parent)
  expect(result.current).toBe(true)
})
