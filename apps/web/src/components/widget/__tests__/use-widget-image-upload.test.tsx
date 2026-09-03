// @vitest-environment happy-dom
/**
 * GH #464 regression pin: attaching/pasting an image can be a first-time
 * visitor's very first session-requiring action, and anonymous widget sessions
 * are lazily minted. The widget upload hook must establish a session before
 * POSTing to /api/widget/upload, or the request goes out with no Bearer and
 * 401s silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { clearWidgetToken, getWidgetToken, readPersistedToken } from '@/lib/client/widget-auth'

installInMemoryLocalStorage()

vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { anonymous: vi.fn() } },
}))
vi.mock('@/lib/shared/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/i18n')>()),
  loadMessages: vi.fn().mockResolvedValue({}),
}))

import { WidgetAuthProvider } from '../widget-auth-provider'
import { useWidgetImageUpload, WidgetSessionError } from '../use-widget-image-upload'
import { authClient } from '@/lib/client/auth-client'

const mintAnon = vi.mocked(authClient.signIn.anonymous)

/** Mimic better-auth's bearer flow: the token arrives via `set-auth-token`. */
function mintSucceedsWith(token: string) {
  mintAnon.mockImplementation(async (opts?: unknown) => {
    const { fetchOptions } = (opts ?? {}) as {
      fetchOptions?: { onSuccess?: (ctx: { response: Response }) => void }
    }
    fetchOptions?.onSuccess?.({
      response: new Response(null, { headers: { 'set-auth-token': token } }),
    })
    return { data: { user: { id: 'anon' } }, error: null } as never
  })
}

function mintFails() {
  mintAnon.mockResolvedValue({ data: null, error: { message: 'nope' } } as never)
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient()
  return (
    <QueryClientProvider client={qc}>
      <WidgetAuthProvider portalSessionToken={null}>{children}</WidgetAuthProvider>
    </QueryClientProvider>
  )
}

const pngFile = () => new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })

const uploadOk = { ok: true, json: async () => ({ publicUrl: '/api/storage/shot.png' }) }

describe('useWidgetImageUpload — session guard (GH #464)', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
    mintAnon.mockReset()
    vi.unstubAllGlobals()
  })

  it('mints an anonymous session before uploading and sends the Bearer', async () => {
    mintSucceedsWith('anon-fresh')
    const fetchMock = vi.fn().mockResolvedValue(uploadOk)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useWidgetImageUpload(), { wrapper })
    expect(getWidgetToken()).toBeNull()

    const url = await result.current.upload(pngFile())

    expect(url).toBe('/api/storage/shot.png')
    expect(mintAnon).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe('/api/widget/upload')
    expect(init.headers).toEqual({ Authorization: 'Bearer anon-fresh' })
    // The minted token is persisted so the next visit on this origin reuses it.
    expect(readPersistedToken()).toBe('anon-fresh')
  })

  it('does not upload when no session can be established; surfaces onError and rejects', async () => {
    mintFails()
    const fetchMock = vi.fn().mockResolvedValue(uploadOk)
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()

    const { result } = renderHook(() => useWidgetImageUpload({ onError }), { wrapper })

    await expect(result.current.upload(pngFile())).rejects.toBeInstanceOf(WidgetSessionError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(WidgetSessionError)
  })

  it('skips the mint when a session already exists', async () => {
    mintSucceedsWith('anon-first')
    const fetchMock = vi.fn().mockResolvedValue(uploadOk)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useWidgetImageUpload(), { wrapper })
    await result.current.upload(pngFile())
    await result.current.upload(pngFile())

    expect(mintAnon).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(call[1].headers).toEqual({ Authorization: 'Bearer anon-first' })
    }
  })

  it('coalesces concurrent first uploads (multi-file paste) onto one mint', async () => {
    mintSucceedsWith('anon-shared')
    const fetchMock = vi.fn().mockResolvedValue(uploadOk)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useWidgetImageUpload(), { wrapper })
    await Promise.all([result.current.upload(pngFile()), result.current.upload(pngFile())])

    expect(mintAnon).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
