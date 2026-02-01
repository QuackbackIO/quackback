/**
 * Image Upload Hook
 *
 * Provides a function to upload images to S3-compatible storage via presigned URLs.
 * Handles validation, error handling, and returns the public URL on success.
 */

import { getPresignedUploadUrlFn } from '@/lib/server/functions/uploads'
import { MAX_FILE_SIZE } from '@/lib/server/storage/s3'

interface UseImageUploadOptions {
  /** Prefix for storage keys (default: 'uploads') */
  prefix?: string
  /** Callback on upload start */
  onStart?: () => void
  /** Callback on upload success */
  onSuccess?: (url: string) => void
  /** Callback on upload error */
  onError?: (error: Error) => void
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

/**
 * Hook for uploading images to S3-compatible storage.
 *
 * Usage:
 * ```tsx
 * const { upload, isUploading } = useImageUpload({
 *   prefix: 'changelog-images',
 *   onError: (error) => toast.error(error.message),
 * })
 *
 * // In RichTextEditor:
 * <RichTextEditor
 *   features={{ images: true }}
 *   onImageUpload={upload}
 * />
 * ```
 */
export function useImageUpload(options: UseImageUploadOptions = {}) {
  const { prefix = 'uploads', onStart, onSuccess, onError } = options

  /**
   * Upload an image file and return its public URL.
   */
  const upload = async (file: File): Promise<string> => {
    // Validate file type
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      const error = new Error(
        `Invalid file type: ${file.type}. Allowed types: JPEG, PNG, GIF, WebP.`
      )
      onError?.(error)
      throw error
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      const error = new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`)
      onError?.(error)
      throw error
    }

    onStart?.()

    try {
      // Get presigned URL from server
      const { uploadUrl, publicUrl } = await getPresignedUploadUrlFn({
        data: {
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
          prefix,
        },
      })

      // Upload directly to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      })

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`)
      }

      onSuccess?.(publicUrl)
      return publicUrl
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Upload failed')
      onError?.(error)
      throw error
    }
  }

  return { upload }
}

/**
 * Create an upload function for changelog images specifically.
 * This is a convenience wrapper that uses the changelog-images prefix.
 */
export function useChangelogImageUpload(options: Omit<UseImageUploadOptions, 'prefix'> = {}) {
  return useImageUpload({ ...options, prefix: 'changelog-images' })
}
