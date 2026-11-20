import { afterEach, describe, expect, it, vi } from 'vitest'
import { putStorageUpload } from '../storage-upload'
import { ValidationError } from '@/lib/shared/errors'

const file = new Blob(['<svg/>'], { type: 'image/svg+xml' })

function answer(status: number, body?: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('putStorageUpload', () => {
  it('PUTs the file with its type', async () => {
    const fetchMock = answer(200)
    await putStorageUpload('/api/storage/header-logos/x.svg?sig', file, 'Upload failed')
    expect(fetchMock).toHaveBeenCalledWith('/api/storage/header-logos/x.svg?sig', {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'image/svg+xml' },
    })
  })

  it('passes on a refusal written for people, as a typed error', async () => {
    answer(400, {
      code: 'SVG_NOT_SAFE',
      error: "This SVG can't be used. Try a PNG or a simpler SVG.",
    })
    const attempt = putStorageUpload('/api/storage/x', file, 'Upload failed')
    await expect(attempt).rejects.toBeInstanceOf(ValidationError)
    await expect(attempt).rejects.toMatchObject({
      code: 'SVG_NOT_SAFE',
      message: "This SVG can't be used. Try a PNG or a simpler SVG.",
    })
  })

  it('keeps any other failure to the fallback', async () => {
    answer(400, { error: 'File content does not match its type' })
    await expect(putStorageUpload('/api/storage/x', file, 'Upload failed')).rejects.toThrow(
      /^Upload failed$/
    )
    answer(500)
    await expect(putStorageUpload('/api/storage/x', file, 'Upload failed')).rejects.toThrow(
      /^Upload failed$/
    )
  })
})
