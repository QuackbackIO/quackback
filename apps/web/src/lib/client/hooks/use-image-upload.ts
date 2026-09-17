import { useCallback } from 'react'
import {
  MAX_FILE_SIZE,
  isAllowedImageType,
  isAllowedMediaType,
  maxMediaFileSize,
  resolveVideoMimeType,
} from '@/lib/shared/storage-config'

interface UseImageUploadOptions {
  prefix?: string
  endpoint?: string
  extraHeaders?: () => HeadersInit
  onStart?: () => void
  onSuccess?: (url: string) => void
  onError?: (error: Error) => void
}

type FileValidator = (file: File) => Error | null

/** Client-side type/size check shared by every upload flavour; null when uploadable. */
export function validateImageFile(file: File): Error | null {
  if (!isAllowedImageType(file.type)) {
    return new Error(`Invalid file type: ${file.type}. Allowed types: JPEG, PNG, GIF, WebP.`)
  }
  if (file.size > MAX_FILE_SIZE) {
    return new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`)
  }
  return null
}

export function validateMediaFile(file: File): Error | null {
  const contentType = isAllowedImageType(file.type)
    ? file.type
    : resolveVideoMimeType(file.type, file.name)
  if (!contentType || !isAllowedMediaType(contentType)) {
    return new Error(
      'Invalid file type. Allowed types: JPEG, PNG, GIF, WebP, AVIF, MP4, WebM, MOV, M4V.'
    )
  }
  const maxBytes = maxMediaFileSize(contentType)
  if (file.size > maxBytes) {
    return new Error(`File too large. Maximum size is ${maxBytes / 1024 / 1024}MB.`)
  }
  return null
}

type FileNormalizer = (file: File) => File

function normalizeMediaFile(file: File): File {
  const contentType = resolveVideoMimeType(file.type, file.name)
  if (!contentType || contentType === file.type) return file
  return new File([file], file.name, { type: contentType, lastModified: file.lastModified })
}

function useFileUpload(
  options: UseImageUploadOptions,
  validate: FileValidator,
  normalize: FileNormalizer = (file) => file
) {
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
      file = normalize(file)
      const invalid = validate(file)
      if (invalid) {
        onError?.(invalid)
        throw invalid
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
    [prefix, endpoint, extraHeaders, onStart, onSuccess, onError, validate, normalize]
  )

  return { upload }
}

export function useImageUpload(options: UseImageUploadOptions = {}) {
  return useFileUpload(options, validateImageFile)
}

export function useMediaUpload(options: UseImageUploadOptions = {}) {
  return useFileUpload(options, validateMediaFile, normalizeMediaFile)
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

export function usePostMediaUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useMediaUpload({ ...options, prefix: 'post-media', endpoint: '/api/upload/image' })
}

export function usePortalImageUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useImageUpload({ ...options, endpoint: '/api/portal/upload' })
}

export function usePortalMediaUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useMediaUpload({ ...options, prefix: 'portal-media', endpoint: '/api/portal/upload' })
}

// The widget flavour lives in `@/components/widget/use-widget-image-upload`:
// it needs the widget auth context to mint a session before uploading.
