/**
 * Client-side file upload, shared by every composer (admin, widget, portal).
 * POSTs the raw file body (not multipart) via XMLHttpRequest instead of
 * fetch(), so the caller gets real upload progress — fetch() never reports
 * any until the whole thing has landed. The server decides the real type and
 * cap; this stays dumb about anything but the transport.
 */
import { familyFor, formatBytes, maxBytesForFamily } from '@/lib/shared/files/file-types'
import type { UploadedFile } from '@/lib/shared/conversation/types'

/** A rejected upload. `reason` mirrors the server's FileRejectedError reason
 *  (empty | too_large | blocked) when the rejection is definitive — a
 *  pre-check or a server refusal that will fail again unchanged. No reason
 *  means a transient failure (network, abort-adjacent, a 500): worth a retry. */
export class UploadError extends Error {
  reason?: string
  constructor(message: string, reason?: string) {
    super(message)
    this.name = 'UploadError'
    this.reason = reason
  }
}

export interface UploadFileOptions {
  endpoint: string
  headers?: HeadersInit
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

/**
 * The widget's own endpoints (401/429/503) answer `{ error: { code,
 * message } }` (`widgetJsonError`); every other upload failure answers
 * `{ error: <string>, reason? }`. Reads a message out of either shape,
 * never stringifying an object into "[object Object]".
 */
function errorMessageFrom(error: unknown): string | undefined {
  if (typeof error === 'string') return error
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }
  return undefined
}

/** Clipboard pastes often hand over a nameless Blob. Give it a name that
 *  matches its declared type so the server (and the tray) show something
 *  sensible instead of a bare extension-less "file". */
function fallbackName(file: File): string {
  if (file.name) return file.name
  const sub = file.type.split('/')[1]?.split(';')[0]?.toLowerCase()
  const ext = sub === 'jpeg' ? 'jpg' : sub && /^[a-z0-9]+$/.test(sub) ? sub : 'png'
  return `pasted-image.${ext}`
}

/** POSTs `file`'s raw bytes to `${endpoint}?name=<name>`, resolving the
 *  stored UploadedFile or rejecting with an UploadError. */
export function uploadFile(file: File, options: UploadFileOptions): Promise<UploadedFile> {
  const { endpoint, headers, onProgress, signal } = options
  const name = fallbackName(file)

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${endpoint}?name=${encodeURIComponent(name)}`)
    if (headers) {
      new Headers(headers).forEach((value, key) => xhr.setRequestHeader(key, value))
    }
    // Set last so it always wins over anything (unexpectedly) in `headers`.
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    signal?.addEventListener('abort', () => xhr.abort())

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.total > 0) onProgress(e.loaded / e.total)
    }
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    xhr.onerror = () => reject(new UploadError('Upload failed'))
    xhr.onload = () => {
      let body: { error?: unknown; reason?: string } & Partial<UploadedFile> = {}
      try {
        body = JSON.parse(xhr.responseText || '{}')
      } catch {
        body = {}
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (!body.fileId || !body.url) {
          reject(new UploadError('Upload failed'))
          return
        }
        resolve(body as UploadedFile)
        return
      }
      const message = errorMessageFrom(body.error)
      if (xhr.status === 429) {
        reject(new UploadError(message ?? 'Too many uploads, slow down', 'rate_limited'))
        return
      }
      reject(new UploadError(message ?? 'Upload failed', body.reason))
    }
    xhr.send(file)
  })
}

/** Universal client-side pre-checks every surface enforces before ever
 *  touching the network — instant feedback; the server re-checks regardless. */
export function checkFileBeforeUpload(file: File): UploadError | null {
  if (file.size === 0) return new UploadError('The file is empty', 'empty')
  const family = familyFor(file.name, file.type)
  const maxBytes = maxBytesForFamily(family)
  if (file.size > maxBytes) {
    return new UploadError(`Over ${formatBytes(maxBytes)}`, 'too_large')
  }
  return null
}
