import { useCallback } from 'react'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useWidgetAuth } from './widget-auth-provider'

interface UseWidgetImageUploadOptions {
  onStart?: () => void
  onSuccess?: (url: string) => void
  onError?: (error: Error) => void
}

/** Thrown when no widget session could be established before the upload. */
export class WidgetSessionError extends Error {
  constructor() {
    super('Could not create session')
    this.name = 'WidgetSessionError'
  }
}

/**
 * Image upload for widget surfaces (post composer, comment forms, messenger).
 *
 * Anonymous widget sessions are lazily minted on the visitor's first write, and
 * attaching/pasting an image can be that first write — so there may be no
 * session yet. Mint one first (anonymous is fine) or the upload goes out with
 * no Bearer and `/api/widget/upload` 401s silently (GH #464).
 */
export function useWidgetImageUpload(options: UseWidgetImageUploadOptions = {}) {
  const { onStart, onSuccess, onError } = options
  const { ensureSession } = useWidgetAuth()
  const { upload: rawUpload } = useImageUpload({
    endpoint: '/api/widget/upload',
    extraHeaders: getWidgetAuthHeaders,
    onStart,
    onSuccess,
    onError,
  })

  const upload = useCallback(
    async (file: File): Promise<string> => {
      const ready = await ensureSession()
      if (!ready) {
        const error = new WidgetSessionError()
        onError?.(error)
        throw error
      }
      return rawUpload(file)
    },
    [ensureSession, rawUpload, onError]
  )

  return { upload }
}
