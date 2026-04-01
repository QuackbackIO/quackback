import { useCallback } from 'react'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { MAX_FILE_SIZE, isAllowedImageType } from '@/lib/server/storage/s3'

interface UseImageUploadOptions {
  prefix?: string
  endpoint?: string
  extraHeaders?: () => HeadersInit
  onStart?: () => void
  onSuccess?: (url: string) => void
  onError?: (error: Error) => void
}

export function useImageUpload(options: UseImageUploadOptions = {}) {
  const {
    prefix = 'uploads',
    endpoint = '/api/upload/image',
    extraHeaders,
    onStart,
    onSuccess,
    onError,
  } = options

  const upload = useCallback(
    async (file: File): Promise<string> => {
      if (!isAllowedImageType(file.type)) {
        const error = new Error(
          `Invalid file type: ${file.type}. Allowed types: JPEG, PNG, GIF, WebP.`
        )
        onError?.(error)
        throw error
      }

      if (file.size > MAX_FILE_SIZE) {
        const error = new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`)
        onError?.(error)
        throw error
      }

      onStart?.()

      try {
        const ext = file.type.split('/')[1] || 'png'
        const namedFile = file.name
          ? file
          : new File([file], `paste-${Date.now()}.${ext}`, { type: file.type })

        const formData = new FormData()
        formData.append('file', namedFile)
        formData.append('prefix', prefix)

        const response = await fetch(endpoint, {
          method: 'POST',
          body: formData,
          headers: extraHeaders?.(),
        })

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(data.error || `Upload failed: ${response.statusText}`)
        }

        const { publicUrl } = (await response.json()) as { publicUrl: string }
        onSuccess?.(publicUrl)
        return publicUrl
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Upload failed')
        onError?.(error)
        throw error
      }
    },
    [prefix, endpoint, extraHeaders, onStart, onSuccess, onError]
  )

  return { upload }
}

export function useChangelogImageUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useImageUpload({ ...options, prefix: 'changelog-images' })
}

export function usePostImageUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useImageUpload({ ...options, prefix: 'post-images' })
}

export function usePortalImageUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useImageUpload({ ...options, endpoint: '/api/portal/upload' })
}

export function useWidgetImageUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useImageUpload({
    ...options,
    endpoint: '/api/widget/upload',
    extraHeaders: getWidgetAuthHeaders,
  })
}
