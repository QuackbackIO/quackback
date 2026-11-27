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
  // Flush the SDK's idle-time panel preload synchronously so assertions can
  // check the iframe right after init.
  vi.stubGlobal(
    'requestIdleCallback',
    vi.fn((cb: () => void) => {
      cb()
      return 1
    })
  )
  vi.stubGlobal('cancelIdleCallback', vi.fn())
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useQuackbackInit', () => {
  it('inits the widget on mount and destroys on unmount', () => {
    const destroy = vi.spyOn(Quackback, 'destroy')
    function C() {
      useQuackbackInit({ instanceUrl: ORIGIN })
      return null
    }
    const { unmount } = render(<C />)
    expect(document.querySelector('iframe.quackback-widget-iframe')).not.toBeNull()
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

  it('logs out when the identity goes back to undefined', () => {
    const logout = vi.spyOn(Quackback, 'logout')
    function C({ token }: { token: string | null }) {
      useQuackbackInit({ instanceUrl: ORIGIN, identity: token ? { ssoToken: token } : undefined })
      return null
    }
    const { rerender, unmount } = render(<C token="token-a" />)
    expect(logout).not.toHaveBeenCalled()
    act(() => rerender(<C token={null} />))
    expect(logout).toHaveBeenCalledTimes(1)
    // Staying signed out does not log out again.
    act(() => rerender(<C token={null} />))
    expect(logout).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('never logs out a visitor who was not identified', () => {
    const logout = vi.spyOn(Quackback, 'logout')
    function C() {
      useQuackbackInit({ instanceUrl: ORIGIN })
      return null
    }
    const { rerender, unmount } = render(<C />)
    act(() => rerender(<C />))
    unmount()
    expect(logout).not.toHaveBeenCalled()
  })

  it('a widget re-created after shouldInitialize toggles does not log out an anonymous visitor', () => {
    const logout = vi.spyOn(Quackback, 'logout')
    function C({ enabled, token }: { enabled: boolean; token: string | null }) {
      useQuackbackInit({
        instanceUrl: ORIGIN,
        shouldInitialize: enabled,
        identity: token ? { ssoToken: token } : undefined,
      })
      return null
    }
    const { rerender, unmount } = render(<C enabled token="token-a" />)
    act(() => rerender(<C enabled={false} token={null} />))
    act(() => rerender(<C enabled token={null} />))
    expect(logout).not.toHaveBeenCalled()
    unmount()
  })

  it('does not init when shouldInitialize is false', () => {
    function C() {
      useQuackbackInit({ instanceUrl: ORIGIN, shouldInitialize: false })
      return null
    }
    render(<C />)
    expect(document.querySelector('iframe.quackback-widget-iframe')).toBeNull()
  })

  it('inits later when shouldInitialize flips to true', () => {
    function C({ enabled }: { enabled: boolean }) {
      useQuackbackInit({ instanceUrl: ORIGIN, shouldInitialize: enabled })
      return null
    }
    const { rerender, unmount } = render(<C enabled={false} />)
    expect(document.querySelector('iframe.quackback-widget-iframe')).toBeNull()
    act(() => rerender(<C enabled={true} />))
    expect(document.querySelector('iframe.quackback-widget-iframe')).not.toBeNull()
    unmount()
  })

  it('respects initializeDelay', () => {
    vi.useFakeTimers()
    // Fake timers replace the sync requestIdleCallback stub — restore it so
    // the panel preload still flushes inline once init fires.
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: () => void) => {
        cb()
        return 1
      })
    )
    function C() {
      useQuackbackInit({ instanceUrl: ORIGIN, initializeDelay: 500 })
      return null
    }
    const { unmount } = render(<C />)
    expect(document.querySelector('iframe.quackback-widget-iframe')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(document.querySelector('iframe.quackback-widget-iframe')).not.toBeNull()
    unmount()
    vi.useRealTimers()
  })
})
