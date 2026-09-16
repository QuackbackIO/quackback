import { vi } from 'vitest'
import {
  canonicalizeVideoMime,
  sniffImageMime,
  sniffVideoMime,
} from '@/lib/server/content/magic-bytes'
import { resolveVideoMimeType } from '@/lib/shared/storage-config'

/**
 * Shared vi.mock factory for @/lib/server/storage/s3.
 *
 * Provides a re-implementation of uploadImageFromFormData that closes over the
 * named mock functions — so tests can spy on uploadObject/generateStorageKey via
 * vi.mocked(), and the mock's internal validation logic stays in one place.
 *
 * Usage in a test file:
 *   vi.mock('@/lib/server/storage/s3', async () => {
 *     const { createS3MockFactory } = await import('../../__tests__/s3-upload-mock')
 *     return createS3MockFactory()
 *   })
 */
export function createS3MockFactory() {
  const MAX_FILE_SIZE = 5 * 1024 * 1024
  const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024
  const mockIsAllowedImageType = vi.fn((type: string) =>
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)
  )
  const mockGenerateStorageKey = vi.fn(
    (prefix: string, filename: string) => `${prefix}/2024/01/abc-${filename}`
  )
  const mockIsAllowedVideoType = vi.fn((type: string) =>
    ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/m4v'].includes(type)
  )
  const mockUploadObject = vi.fn(
    async (key: string, _body?: unknown, _type?: string) => `https://cdn.example.com/${key}`
  )

  const upload = async (formData: FormData, storagePrefix: string, allowVideo: boolean) => {
    const file = formData.get('file')
    if (!(file instanceof File))
      return Response.json({ error: 'No file provided' }, { status: 400 })
    const image = mockIsAllowedImageType(file.type)
    const contentType = image ? file.type : resolveVideoMimeType(file.type, file.name)
    const video = allowVideo && !!contentType && mockIsAllowedVideoType(contentType)
    if (!image && !video) return Response.json({ error: 'Invalid file type' }, { status: 400 })
    const maxSize = video ? MAX_VIDEO_FILE_SIZE : MAX_FILE_SIZE
    if (file.size > maxSize)
      return Response.json(
        { error: `File too large. Maximum size is ${maxSize / 1024 / 1024}MB` },
        { status: 400 }
      )
    try {
      const filename = file.name || `paste-${Date.now()}.${file.type.split('/')[1] || 'bin'}`
      const key = mockGenerateStorageKey(storagePrefix, filename)
      const body = Buffer.from(await file.arrayBuffer())
      const sniffed = video ? sniffVideoMime(body) : sniffImageMime(body)
      const expected = video && contentType ? canonicalizeVideoMime(contentType) : contentType
      if (sniffed !== expected) {
        return Response.json({ error: 'File content does not match its type' }, { status: 400 })
      }
      const publicUrl = await mockUploadObject(key, body, contentType ?? file.type)
      return Response.json({ publicUrl })
    } catch {
      return Response.json({ error: 'Upload failed' }, { status: 500 })
    }
  }

  return {
    isS3Usable: vi.fn(() => true),
    isS3Configured: vi.fn(() => true),
    isAllowedImageType: mockIsAllowedImageType,
    isAllowedVideoType: mockIsAllowedVideoType,
    generateStorageKey: mockGenerateStorageKey,
    uploadObject: mockUploadObject,
    MAX_FILE_SIZE,
    MAX_VIDEO_FILE_SIZE,
    async uploadImageFromFormData(formData: FormData, storagePrefix: string) {
      return upload(formData, storagePrefix, false)
    },
    async uploadMediaFromFormData(formData: FormData, storagePrefix: string) {
      return upload(formData, storagePrefix, true)
    },
  }
}
