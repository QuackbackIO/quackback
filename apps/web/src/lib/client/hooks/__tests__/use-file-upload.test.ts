// @vitest-environment happy-dom
/**
 * The generic composer file-upload wrapper: forwards to uploadFile() with a
 * fixed endpoint/headers and reports failures through onError, same contract
 * every surface-specific flavour below it relies on.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('@/lib/client/files/upload-file', async (orig) => ({
  ...(await orig<typeof import('@/lib/client/files/upload-file')>()),
  uploadFile: vi.fn(),
}))

import { uploadFile } from '@/lib/client/files/upload-file'
import {
  useAgentFileUpload,
  usePortalFileUpload,
  useFileUpload,
} from '@/lib/client/hooks/use-file-upload'

const mockUpload = vi.mocked(uploadFile)

describe('useFileUpload', () => {
  it('forwards the endpoint, headers, progress and signal to uploadFile', async () => {
    mockUpload.mockResolvedValue({
      fileId: 'file_1',
      url: '/u',
      name: 'a.txt',
      contentType: 'text/plain',
      size: 1,
      family: 'text',
    })
    const headers = vi.fn(() => ({ Authorization: 'Bearer tok' }))
    const { result } = renderHook(() => useFileUpload({ endpoint: '/api/x/files', headers }))
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })
    const onProgress = vi.fn()
    const controller = new AbortController()

    const uploaded = await result.current.upload(file, { onProgress, signal: controller.signal })

    expect(uploaded.fileId).toBe('file_1')
    expect(mockUpload).toHaveBeenCalledWith(file, {
      endpoint: '/api/x/files',
      headers: { Authorization: 'Bearer tok' },
      onProgress,
      signal: controller.signal,
    })
  })

  it('reports a failed upload through onError and rethrows', async () => {
    mockUpload.mockRejectedValue(new Error('Over 25 MB'))
    const onError = vi.fn()
    const { result } = renderHook(() => useFileUpload({ endpoint: '/api/upload/file', onError }))
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })

    await expect(result.current.upload(file, {})).rejects.toThrow('Over 25 MB')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })
})

describe('useAgentFileUpload / usePortalFileUpload', () => {
  it('fixes the agent endpoint to /api/upload/file', async () => {
    mockUpload.mockResolvedValue({
      fileId: 'f',
      url: '/u',
      name: 'a',
      contentType: 'text/plain',
      size: 1,
      family: 'text',
    })
    const { result } = renderHook(() => useAgentFileUpload())
    await result.current.upload(new File(['x'], 'a.txt'), {})
    expect(mockUpload.mock.calls[0]?.[1]).toMatchObject({ endpoint: '/api/upload/file' })
  })

  it('fixes the portal endpoint to /api/portal/files', async () => {
    mockUpload.mockResolvedValue({
      fileId: 'f',
      url: '/u',
      name: 'a',
      contentType: 'text/plain',
      size: 1,
      family: 'text',
    })
    const { result } = renderHook(() => usePortalFileUpload())
    await result.current.upload(new File(['x'], 'a.txt'), {})
    expect(mockUpload.mock.calls[0]?.[1]).toMatchObject({ endpoint: '/api/portal/files' })
  })
})
