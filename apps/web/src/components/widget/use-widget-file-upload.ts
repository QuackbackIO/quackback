import { useCallback } from 'react'
import { UploadError } from '@/lib/client/files/upload-file'
import { useFileUpload, type FileUploadCallOptions } from '@/lib/client/hooks/use-file-upload'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { isBlockedExtension } from '@/lib/shared/files/file-types'
import type { UploadedFile } from '@/lib/shared/conversation/types'
import { useWidgetAuth } from './widget-auth-provider'
import { WidgetSessionError } from './use-widget-image-upload'

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
export function useWidgetFileUpload() {
  const { ensureSession, isIdentified } = useWidgetAuth()
  const { upload: uploadToWidget } = useFileUpload({
    endpoint: '/api/widget/files',
    headers: getWidgetAuthHeaders,
  })

  const upload = useCallback(
    async (file: File, opts: FileUploadCallOptions = {}): Promise<UploadedFile> => {
      if (!isIdentified && isBlockedExtension(file.name)) {
        throw new UploadError("This file type can't be sent", 'blocked')
      }
      const ready = await ensureSession()
      if (!ready) throw new WidgetSessionError()
      return uploadToWidget(file, opts)
    },
    [ensureSession, isIdentified, uploadToWidget]
  )

  return { upload }
}
