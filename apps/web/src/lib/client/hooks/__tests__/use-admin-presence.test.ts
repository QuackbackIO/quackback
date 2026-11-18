// @vitest-environment happy-dom
/**
 * useAdminPresence: presence stays off in automated browsers, except when an
 * e2e test adds ?e2e-presence=1 AND the server confirms the harness gate with
 * a 204 from /api/e2e/presence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const streamEnabled: boolean[] = []
vi.mock('../use-conversation-stream', () => ({
  useConversationStream: (opts: { enabled: boolean }) => {
    streamEnabled.push(opts.enabled)
  },
}))

import { useAdminPresence } from '../use-admin-presence'

const fetchMock = vi.fn()

function setWebdriver(value: boolean) {
  Object.defineProperty(window.navigator, 'webdriver', { value, configurable: true })
}

function setSearch(search: string) {
  window.history.replaceState(null, '', `/admin/inbox${search}`)
}

/** Has any render asked for the stream to be on? */
const everEnabled = () => streamEnabled.some(Boolean)

beforeEach(() => {
  streamEnabled.length = 0
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.sessionStorage.clear()
  setSearch('')
})

afterEach(() => {
  vi.unstubAllGlobals()
  setWebdriver(false)
})

describe('useAdminPresence', () => {
  it('is on for a person (not automated) without asking the server', () => {
    setWebdriver(false)
    renderHook(() => useAdminPresence(true))
    expect(streamEnabled.at(-1)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is off for an automated browser without the flag, and never probes', async () => {
    setWebdriver(true)
    renderHook(() => useAdminPresence(true))
    await new Promise((r) => setTimeout(r, 10))
    expect(everEnabled()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('turns on for an automated browser with the flag when the server answers 204', async () => {
    setWebdriver(true)
    setSearch('?e2e-presence=1')
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    renderHook(() => useAdminPresence(true))
    await waitFor(() => expect(streamEnabled.at(-1)).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/api/e2e/presence', expect.anything())
  })

  it('stays off with the flag when the server answers 404 (harness gate closed)', async () => {
    setWebdriver(true)
    setSearch('?e2e-presence=1')
    fetchMock.mockResolvedValue(new Response('Not found', { status: 404 }))
    renderHook(() => useAdminPresence(true))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 10))
    expect(everEnabled()).toBe(false)
  })

  it('remembers the flag for the tab after navigating away from the flagged URL', async () => {
    setWebdriver(true)
    setSearch('?e2e-presence=1')
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    renderHook(() => useAdminPresence(true)).unmount()
    setSearch('')
    streamEnabled.length = 0
    renderHook(() => useAdminPresence(true))
    await waitFor(() => expect(streamEnabled.at(-1)).toBe(true))
  })

  it('stays off when the caller disables it, flag or not', async () => {
    setWebdriver(true)
    setSearch('?e2e-presence=1')
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    renderHook(() => useAdminPresence(false))
    await new Promise((r) => setTimeout(r, 10))
    expect(everEnabled()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
