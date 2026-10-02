/**
 * Turns a message's stored attachments into what an outbound conversation
 * email actually carries: real MIME parts for the files that are safe to
 * send inline and fit the per-email budget, and plain links for everything
 * else — a stored type that is not on the outbound allowlist, an untrusted
 * sender, too large once earlier files have claimed their share, foreign (no
 * storage key of ours to load), or whose bytes failed to load. Order is
 * preserved, so files that overflow the budget are whichever come last on
 * the message.
 *
 * The allowlist exists because a real attachment is MIME on OUR sending
 * domain: a risky type (an HTML file, a macro-enabled workbook, a script) is
 * never worth the exposure, and several providers (including the one this
 * package ships against) reject the WHOLE message over certain attachment
 * types — restricting to a small safe allowlist sidesteps that failure mode
 * entirely rather than tracking every provider's refusal list.
 *
 * Internal notes never reach this module at all: the write paths that email a
 * conversation (sendAgentMessage, sendVisitorMessage, startAgentConversation)
 * never call it for a note, because a note never calls notifyAgentReply /
 * notifyVisitorMessage / notifyConversationStarted in the first place.
 */
import { MAX_EMAIL_ATTACHMENT_BYTES, type EmailAttachment } from '@quackback/email'
import type { ConversationAttachment } from '@/lib/server/db'
import { getEmailSafeUrl, getS3Object } from '@/lib/server/storage/s3'
import { storedAssetKeyFromSrc } from '@/lib/server/storage/asset-url'
import { familyFor } from '@/lib/shared/files/file-types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation-email-attachments' })

export interface LinkedEmailAttachment {
  name: string
  url: string
}

export interface ResolvedEmailAttachments {
  attachments: EmailAttachment[]
  linked: LinkedEmailAttachment[]
}

export interface ResolveEmailAttachmentsOptions {
  /**
   * False when the sender behind these attachments cannot be vouched for (an
   * anonymous visitor, an inbound email correspondent): every attachment
   * links, whatever its type — real MIME is reserved for files a trusted
   * sender put on the message. Defaults to true, which is right for every
   * caller except the team alert about a visitor's own message.
   */
  trustedSender?: boolean
}

/** Raster types a mail client renders inline without a plugin or a download. */
const RASTER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Office documents in their macro-free OOXML form only — never a macro-enabled
 *  or legacy binary variant, which never appear in this set at all. */
const MACRO_FREE_OFFICE_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/**
 * Whether a file's stored type (sniffed from its bytes, not declared by
 * whoever sent it) is safe to carry as a real MIME part: a raster image, a
 * PDF, plain text, CSV, or a macro-free OOXML document. Everything else —
 * archives, scripts, disk images, HTML/SVG, legacy binary Office formats, and
 * any Office file the preview job found a macro in — travels as a link
 * instead.
 */
function canAttachAsMime(attachment: ConversationAttachment): boolean {
  if (attachment.preview?.macro) return false
  const family = attachment.family ?? familyFor(attachment.name, attachment.contentType)
  switch (family) {
    case 'image':
      return RASTER_IMAGE_TYPES.has(attachment.contentType)
    case 'pdf':
    case 'text':
    case 'csv':
      return true
    case 'document':
    case 'spreadsheet':
    case 'presentation':
      return MACRO_FREE_OFFICE_TYPES.has(attachment.contentType)
    default:
      return false
  }
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Split a message's attachments into inlined MIME parts and links, loading
 * bytes only for the files the allowlist and the budget can still afford.
 * Nothing throws: a storage failure demotes that one file to a link rather
 * than losing the email, and a link that could not be built at all (no S3
 * configured, no key) is simply dropped rather than emitted broken.
 *
 * Budgeting trusts a stored `fileId` attachment's `size` outright (it was
 * read from the bytes themselves by files.service's storeFile) and checks it
 * before touching storage at all. A legacy attachment (no `fileId`, written
 * before the file pipeline existed) carries a `size` nobody ever verified
 * against the object, so its budget is read from the object's own content
 * length instead — before its body, never after — and an object that won't
 * report one is treated as over budget rather than trusted on a number
 * nobody checked.
 */
export async function resolveEmailAttachments(
  attachments: ConversationAttachment[] | null | undefined,
  { trustedSender = true }: ResolveEmailAttachmentsOptions = {}
): Promise<ResolvedEmailAttachments> {
  const result: ResolvedEmailAttachments = { attachments: [], linked: [] }
  if (!attachments || attachments.length === 0) return result

  let usedBytes = 0

  for (const attachment of attachments) {
    const key = storedAssetKeyFromSrc(attachment.url)

    // No storage key of ours — a foreign/legacy URL (pre-pipeline rows, or an
    // inline image lifted from rich content). Nothing to load; link as is.
    if (!key) {
      result.linked.push({ name: attachment.name, url: attachment.url })
      continue
    }

    const linkInstead = (): void => {
      const url = getEmailSafeUrl(key)
      if (url) result.linked.push({ name: attachment.name, url })
    }

    if (!trustedSender || !canAttachAsMime(attachment)) {
      linkInstead()
      continue
    }

    if (typeof attachment.fileId === 'string') {
      if (usedBytes + attachment.size > MAX_EMAIL_ATTACHMENT_BYTES) {
        linkInstead()
        continue
      }
      try {
        const object = await getS3Object(key)
        const content = await readAllBytes(object.body)
        usedBytes += content.byteLength
        result.attachments.push({
          filename: attachment.name,
          contentType: attachment.contentType,
          content,
        })
      } catch (err) {
        log.warn({ err, key }, 'attachment failed to load for outbound email; linking instead')
        linkInstead()
      }
      continue
    }

    try {
      const object = await getS3Object(key)
      if (
        object.contentLength === undefined ||
        usedBytes + object.contentLength > MAX_EMAIL_ATTACHMENT_BYTES
      ) {
        linkInstead()
        continue
      }
      const content = await readAllBytes(object.body)
      usedBytes += content.byteLength
      result.attachments.push({
        filename: attachment.name,
        contentType: attachment.contentType,
        content,
      })
    } catch (err) {
      log.warn({ err, key }, 'attachment failed to load for outbound email; linking instead')
      linkInstead()
    }
  }

  return result
}

/** Escape a plain-text string for safe interpolation into HTML text content. */
function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape a plain-text string for safe interpolation into an HTML attribute. */
function escapeHtmlAttr(text: string): string {
  return escapeHtmlText(text).replace(/"/g, '&quot;')
}

/**
 * Append a simple "Attachments" list of links to a message's rendered body,
 * for whatever did not travel as a real MIME part. A no-op when there is
 * nothing to link, so a message with every file inlined (or none at all)
 * keeps exactly the body it already had.
 */
export function appendLinkedAttachmentsHtml(
  bodyHtml: string,
  linked: LinkedEmailAttachment[]
): string {
  if (linked.length === 0) return bodyHtml
  const items = linked
    .map(
      (file) => `<li><a href="${escapeHtmlAttr(file.url)}">${escapeHtmlText(file.name)}</a></li>`
    )
    .join('')
  return `${bodyHtml}<p>Attachments</p><ul>${items}</ul>`
}
