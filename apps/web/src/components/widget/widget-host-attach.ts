import { familyFor, maxBytesForFamily } from '@/lib/shared/files/file-types'
import type { EnabledTabs } from './widget-nav'

/**
 * Closed refusal codes for `Quackback.attach(...)`. Upload failures after
 * staging (rate limit, blocked type, storage) surface on the composer tile,
 * exactly as they do for a file the visitor picked.
 */
export type HostAttachError =
  'ATTACHMENT_INVALID' | 'ATTACHMENT_TOO_LARGE' | 'ATTACHMENT_UNAVAILABLE'

export type HostAttachResolution =
  | { ok: true; requestId: string; file: File }
  | { ok: false; requestId: string | null; error: HostAttachError }

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** A display name: 1..255 chars, no path separators, no control chars, no padding, not only dots. */
export function isHostAttachmentName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 255 &&
    name === name.trim() &&
    !/[\\/]/.test(name) &&
    !CONTROL.test(name) &&
    !/^\.+$/.test(name)
  )
}

/**
 * Validate a `quackback:attach` payload from the host SDK and turn its Blob
 * into the File the messenger composer stages. The payload has exactly
 * `requestId`, `file` and `name`; the Blob arrives by structured clone. Files
 * go to the messenger, so the command is unavailable when messages are off.
 */
export function resolveHostAttachment(data: unknown, tabs: EnabledTabs): HostAttachResolution {
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  const requestId =
    typeof payload?.requestId === 'string' && REQUEST_ID.test(payload.requestId)
      ? payload.requestId
      : null
  const refuse = (error: HostAttachError): HostAttachResolution => ({ ok: false, requestId, error })
  if (!payload || !requestId) return refuse('ATTACHMENT_INVALID')
  const keys = Object.keys(payload).sort()
  if (keys.length !== 3 || keys[0] !== 'file' || keys[1] !== 'name' || keys[2] !== 'requestId') {
    return refuse('ATTACHMENT_INVALID')
  }
  const { file, name } = payload
  if (!(file instanceof Blob) || file.size <= 0 || !isHostAttachmentName(name)) {
    return refuse('ATTACHMENT_INVALID')
  }
  if (!tabs.messages) return refuse('ATTACHMENT_UNAVAILABLE')
  if (file.size > maxBytesForFamily(familyFor(name, file.type)))
    return refuse('ATTACHMENT_TOO_LARGE')
  return { ok: true, requestId, file: new File([file], name, { type: file.type }) }
}
