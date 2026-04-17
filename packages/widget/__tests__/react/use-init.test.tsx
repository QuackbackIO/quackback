import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useQuackbackInit } from '../../src/react/use-init'
import Quackback from '../../src'

const ORIGIN = 'https://feedback.acme.com'

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  )
})
afterEach(() => vi.restoreAllMocks())

describe('useQuackbackInit', () => {
  it('inits the widget on mount and destroys on unmount', () => {
    const destroy = vi.spyOn(Quackback, 'destroy')
    function C() {
      useQuackbackInit({ instanceUrl: ORIGIN })
      return null
    }
    const { unmount } = render(<C />)
    expect(document.querySelector('iframe[title="Feedback Widget"]')).not.toBeNull()
    unmount()
    expect(destroy).toHaveBeenCalled()
  })

  it('re-calls identify when the identity option changes', () => {
    const identify = vi.spyOn(Quackback, 'identify')
    function C({ user }: { user: { id: string; email: string } | null }) {
      useQuackbackInit({
        instanceUrl: ORIGIN,
        identity: user ? { id: user.id, email: user.email } : undefined,
      })
      return null
    }
    const { rerender, unmount } = render(<C user={{ id: 'u1', email: 'a@b.c' }} />)
    identify.mockClear()
    act(() => rerender(<C user={{ id: 'u2', email: 'x@y.z' }} />))
    expect(identify).toHaveBeenCalledWith({ id: 'u2', email: 'x@y.z' })
    unmount()
  })

  it('does not init when shouldInitialize is false', () => {
    function C() {
      useQuackbackInit({ instanceUrl: ORIGIN, shouldInitialize: false })
      return null
    }
    render(<C />)
    expect(document.querySelector('iframe[title="Feedback Widget"]')).toBeNull()
  })

  it('inits later when shouldInitialize flips to true', () => {
    function C({ enabled }: { enabled: boolean }) {
      useQuackbackInit({ instanceUrl: ORIGIN, shouldInitialize: enabled })
      return null
    }
    const { rerender, unmount } = render(<C enabled={false} />)
    expect(document.querySelector('iframe[title="Feedback Widget"]')).toBeNull()
    act(() => rerender(<C enabled={true} />))
    expect(document.querySelector('iframe[title="Feedback Widget"]')).not.toBeNull()
    unmount()
  })

  it('respects initializeDelay', () => {
    vi.useFakeTimers()
    function C() {
      useQuackbackInit({ instanceUrl: ORIGIN, initializeDelay: 500 })
      return null
    }
    const { unmount } = render(<C />)
    expect(document.querySelector('iframe[title="Feedback Widget"]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(document.querySelector('iframe[title="Feedback Widget"]')).not.toBeNull()
    unmount()
    vi.useRealTimers()
  })
})
