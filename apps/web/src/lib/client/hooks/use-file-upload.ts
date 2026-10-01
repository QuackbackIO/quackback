import { useCallback } from 'react'
import { uploadFile } from '@/lib/client/files/upload-file'
import type { UploadedFile } from '@/lib/shared/conversation/types'

interface UseFileUploadOptions {
  endpoint: string
  headers?: () => HeadersInit
  onError?: (error: Error) => void
}

interface FileUploadCallOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

/**
 * Composer file upload for a fixed endpoint: wraps uploadFile() with the
 * surface's endpoint/headers so the composer attachments hook only has to
 * inject `(file, { onProgress, signal }) => Promise<UploadedFile>`.
 */
export function useFileUpload({ endpoint, headers, onError }: UseFileUploadOptions) {
  const upload = useCallback(
    async (file: File, opts: FileUploadCallOptions = {}): Promise<UploadedFile> => {
      try {
        return await uploadFile(file, {
          endpoint,
          headers: headers?.(),
          onProgress: opts.onProgress,
          signal: opts.signal,
        })
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Upload failed')
        onError?.(error)
        throw error
      }
    },
    [endpoint, headers, onError]
  )

  return { upload }
}

/** A team member attaching a file to a conversation/ticket reply or note. */
export function useAgentFileUpload(options: Omit<UseFileUploadOptions, 'endpoint'> = {}) {
  return useFileUpload({ ...options, endpoint: '/api/upload/file' })
}

/** A signed-in portal user attaching a file to their support thread. */
export function usePortalFileUpload(options: Omit<UseFileUploadOptions, 'endpoint'> = {}) {
  return useFileUpload({ ...options, endpoint: '/api/portal/files' })
}
