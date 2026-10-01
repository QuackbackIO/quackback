/**
 * Turns a message's stored attachments into what an outbound conversation
 * email actually carries: real MIME parts for the files that fit the
 * per-email budget, and plain links for everything else — too large once
 * earlier files have claimed their share, foreign (no storage key of ours to
 * load), or whose bytes failed to load. Order is preserved, so files that
 * overflow the budget are whichever come last on the message.
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
 * bytes only for the files the budget can still afford. Nothing throws: a
 * storage failure demotes that one file to a link rather than losing the
 * email, and a link that could not be built at all (no S3 configured, no key)
 * is simply dropped rather than emitted broken.
 */
export async function resolveEmailAttachments(
  attachments: ConversationAttachment[] | null | undefined
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
