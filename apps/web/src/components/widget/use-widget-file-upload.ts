import { useCallback } from 'react'
import { uploadFile, UploadError } from '@/lib/client/files/upload-file'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { isBlockedExtension } from '@/lib/shared/files/file-types'
import type { UploadedFile } from '@/lib/shared/conversation/types'
import { useWidgetAuth } from './widget-auth-provider'
import { WidgetSessionError } from './use-widget-image-upload'

interface UseWidgetFileUploadOptions {
  onError?: (error: Error) => void
}

interface FileUploadCallOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

/**
 * File upload for the widget messenger composer.
 *
 * Mirrors useWidgetImageUpload: anonymous widget sessions are lazily minted,
 * and attaching a file can be the visitor's first write, so a session is
 * ensured before the request goes out (GH #464). An identified visitor comes
 * from a verified ssoToken; anyone else is unverified, so executables and
 * scripts are refused client-side too, before the session mint or the
 * network call — the server refuses them regardless.
 */
export function useWidgetFileUpload(options: UseWidgetFileUploadOptions = {}) {
  const { onError } = options
  const { ensureSession, isIdentified } = useWidgetAuth()

  const upload = useCallback(
    async (file: File, opts: FileUploadCallOptions = {}): Promise<UploadedFile> => {
      if (!isIdentified && isBlockedExtension(file.name)) {
        const error = new UploadError("This file type can't be sent", 'blocked')
        onError?.(error)
        throw error
      }
      const ready = await ensureSession()
      if (!ready) {
        const error = new WidgetSessionError()
        onError?.(error)
        throw error
      }
      try {
        return await uploadFile(file, {
          endpoint: '/api/widget/files',
          headers: getWidgetAuthHeaders(),
          onProgress: opts.onProgress,
          signal: opts.signal,
        })
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Upload failed')
        onError?.(error)
        throw error
      }
    },
    [ensureSession, isIdentified, onError]
  )

  return { upload }
}
