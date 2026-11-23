/**
 * The browser half of an upload: PUT the file to the URL an upload server fn
 * handed out (always this app's /api/storage proxy).
 */
import { ValidationError } from '@/lib/shared/errors'

/** Refusals the storage route words for the person uploading. */
const PERSON_FACING_CODES = new Set(['SVG_NOT_SAFE'])

/**
 * PUT `file` to `uploadUrl`. A refusal the route words for people (such as an
 * SVG that cannot be made safe) is thrown as a ValidationError carrying its
 * code and message, so `errorText` shows it; any other failure throws
 * `fallback`.
 */
export async function putStorageUpload(
  uploadUrl: string,
  file: Blob,
  fallback: string
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (response.ok) return
  const body = (await response.json().catch(() => null)) as {
    code?: unknown
    error?: unknown
  } | null
  if (
    typeof body?.code === 'string' &&
    PERSON_FACING_CODES.has(body.code) &&
    typeof body.error === 'string'
  ) {
    throw new ValidationError(body.code, body.error)
  }
  throw new Error(fallback)
}
