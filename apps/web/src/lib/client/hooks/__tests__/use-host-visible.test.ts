// @vitest-environment happy-dom
/**
 * A host that hid the frame (a tab, a closed panel) says when it shows it
 * again, so the frame can catch up on what it missed while out of sight.
 */
import { afterEach, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { HOST_VISIBLE_MESSAGE, useHostVisibleCount } from '../use-host-visible'

afterEach(cleanup)

const send = (data: unknown, source: MessageEventSource | null) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source }))
  })

it('counts each time the host shows the frame', () => {
  const { result } = renderHook(() => useHostVisibleCount())
  expect(result.current).toBe(0)
  send({ type: HOST_VISIBLE_MESSAGE }, window.parent)
  expect(result.current).toBe(1)
  send({ type: HOST_VISIBLE_MESSAGE }, window.parent)
  expect(result.current).toBe(2)
})

it('ignores other messages and other windows', () => {
  const { result } = renderHook(() => useHostVisibleCount())
  send({ type: 'quackback:open' }, window.parent)
  send({ type: HOST_VISIBLE_MESSAGE }, null)
  send(null, window.parent)
  expect(result.current).toBe(0)
})
