import { vi } from 'vitest'

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
  const mockIsAllowedImageType = vi.fn((type: string) =>
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)
  )
  const mockGenerateStorageKey = vi.fn(
    (prefix: string, filename: string) => `${prefix}/2024/01/abc-${filename}`
  )
  const mockUploadObject = vi.fn(
    async (key: string, _body?: unknown, _type?: string) => `https://cdn.example.com/${key}`
  )

  return {
    isS3Configured: vi.fn(() => true),
    isAllowedImageType: mockIsAllowedImageType,
    generateStorageKey: mockGenerateStorageKey,
    uploadObject: mockUploadObject,
    MAX_FILE_SIZE,
    async uploadImageFromFormData(formData: FormData, storagePrefix: string) {
      const file = formData.get('file')
      if (!(file instanceof File))
        return Response.json({ error: 'No file provided' }, { status: 400 })
      if (!mockIsAllowedImageType(file.type))
        return Response.json({ error: 'Invalid file type' }, { status: 400 })
      if (file.size > MAX_FILE_SIZE)
        return Response.json(
          { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
          { status: 400 }
        )
      try {
        const filename = file.name || `paste-${Date.now()}.${file.type.split('/')[1] || 'png'}`
        const key = mockGenerateStorageKey(storagePrefix, filename)
        const publicUrl = await mockUploadObject(
          key,
          Buffer.from(await file.arrayBuffer()),
          file.type
        )
        return Response.json({ publicUrl })
      } catch {
        return Response.json({ error: 'Upload failed' }, { status: 500 })
      }
    },
  }
}
