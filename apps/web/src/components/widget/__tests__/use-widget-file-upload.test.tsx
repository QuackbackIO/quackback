// @vitest-environment happy-dom
/**
 * Widget file upload: mirrors use-widget-image-upload's session guard (GH
 * #464) — attaching a file can be a first-time visitor's very first
 * session-requiring action, so a session is minted before the request goes
 * out. An anonymous visitor's identity is unverified, so the client also
 * blocks an executable/script extension before ever touching the network;
 * an identified visitor (verified ssoToken) is not held to that check.
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
vi.mock('@/lib/client/files/upload-file', async (orig) => ({
  ...(await orig<typeof import('@/lib/client/files/upload-file')>()),
  uploadFile: vi.fn(),
}))

import { WidgetAuthProvider } from '../widget-auth-provider'
import { useWidgetFileUpload } from '../use-widget-file-upload'
import { WidgetSessionError } from '../use-widget-image-upload'
import { authClient } from '@/lib/client/auth-client'
import { uploadFile } from '@/lib/client/files/upload-file'

const mintAnon = vi.mocked(authClient.signIn.anonymous)
const mockUpload = vi.mocked(uploadFile)

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

const txtFile = () => new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' })
const exeFile = () => new File([new Uint8Array([1])], 'cert-helper.exe', { type: '' })

const uploaded = {
  fileId: 'file_1',
  url: '/api/storage/files/notes.txt',
  name: 'notes.txt',
  contentType: 'text/plain',
  size: 3,
  family: 'text' as const,
}

describe('useWidgetFileUpload — session guard', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
    mintAnon.mockReset()
    mockUpload.mockReset()
    mockUpload.mockResolvedValue(uploaded)
  })

  it('mints an anonymous session before uploading and sends the Bearer', async () => {
    mintSucceedsWith('anon-fresh')
    const { result } = renderHook(() => useWidgetFileUpload(), { wrapper })
    expect(getWidgetToken()).toBeNull()

    const file = await result.current.upload(txtFile(), {})

    expect(file).toEqual(uploaded)
    expect(mintAnon).toHaveBeenCalledTimes(1)
    expect(mockUpload).toHaveBeenCalledTimes(1)
    const [, opts] = mockUpload.mock.calls[0] as [File, { endpoint: string; headers?: HeadersInit }]
    expect(opts.endpoint).toBe('/api/widget/files')
    expect(opts.headers).toEqual({ Authorization: 'Bearer anon-fresh' })
    expect(readPersistedToken()).toBe('anon-fresh')
  })

  it('does not upload when no session can be established; surfaces onError and rejects', async () => {
    mintFails()
    const onError = vi.fn()
    const { result } = renderHook(() => useWidgetFileUpload({ onError }), { wrapper })

    await expect(result.current.upload(txtFile(), {})).rejects.toBeInstanceOf(WidgetSessionError)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(WidgetSessionError)
  })

  it('blocks an anonymous visitor from sending a blocked extension before minting anything', async () => {
    mintSucceedsWith('anon-should-not-exist')
    const onError = vi.fn()
    const { result } = renderHook(() => useWidgetFileUpload({ onError }), { wrapper })

    await expect(result.current.upload(exeFile(), {})).rejects.toThrow(
      "This file type can't be sent"
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(mintAnon).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('skips the mint when a session already exists', async () => {
    mintSucceedsWith('anon-first')
    const { result } = renderHook(() => useWidgetFileUpload(), { wrapper })
    await result.current.upload(txtFile(), {})
    await result.current.upload(txtFile(), {})

    expect(mintAnon).toHaveBeenCalledTimes(1)
    expect(mockUpload).toHaveBeenCalledTimes(2)
  })
})
