/**
 * Quinn vision: turn a customer screenshot into image input for the model.
 *
 * The thread mapper (assistant.thread.ts) carries image attachments through on
 * customer turns; this module renders those turns into model messages. Two
 * regimes, gated by the CALLER (assistant.runtime.ts) on the effective
 * assistant chat model's vision capability (ai/models.ts):
 *
 *   - vision-capable: the customer turn becomes a multi-part user message —
 *      a text part (the message text, or a placeholder for an image-only
 *      message) followed by one image part per image attachment the vision
 *      model actually accepts (jpeg/png/gif/webp). An attachment outside that
 *      set (HEIC, TIFF, SVG, BMP, AVIF, ...) sends its browser-viewable
 *      rendition instead when the preview job made one (a JPEG — HEIC's
 *      case), else it degrades to the same `[image attached: name]` text
 *      note the text-only regime uses, so a turn never fails by sending the
 *      model a type it rejects. Image URLs from the upload pipeline are
 *      absolutized from the immutable system host, since the provider
 *      fetches the URL itself (a relative `/api/storage/...` path is
 *      meaningless off-host).
 *   - text-only: no image part is EVER emitted (a text-only endpoint would
 *      reject or silently drop them); the turn degrades to a textual
 *      `[image attached: name]` note so Quinn knows a screenshot exists and
 *      can say honestly that it cannot view it.
 *
 * Only customer turns carry images: Quinn's own replies and human teammate
 * turns never need their attachments re-grounded for the model.
 */
import { absolutizeOffHostAssetUrl } from '@/lib/server/storage/asset-url'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'

/** Image types the vision model actually accepts; everything else needs a
 *  rendition or degrades to a text note rather than being sent as-is. */
const VISION_SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** Structural twin of the runtime's AssistantThreadMessage (avoiding the import cycle). */
export interface ThreadMessageWithAttachments {
  sender: 'customer' | 'assistant' | 'human_agent'
  content: string
  attachments?: ConversationAttachment[]
}

export interface ThreadModelMessage {
  role: 'user' | 'assistant'
  content:
    | string
    | Array<
        | { type: 'text'; content: string }
        | { type: 'image'; source: { type: 'url'; value: string; mimeType: string } }
      >
}

/** Cap on images per turn — bounds upload fetch cost and prompt size. */
const MAX_IMAGES_PER_MESSAGE = 4

function imageAttachments(attachments: ConversationAttachment[] | undefined) {
  return (attachments ?? [])
    .filter((a) => a.contentType.startsWith('image/'))
    .slice(0, MAX_IMAGES_PER_MESSAGE)
}

/** Make an upload-pipeline URL absolute so the model provider can fetch it. */
export function resolveImageUrl(url: string): string {
  return absolutizeOffHostAssetUrl(url)
}

interface ResolvedVisionImage {
  name: string
  url: string
  mimeType: string
}

/**
 * What to actually send the vision model for one image attachment: its own
 * bytes when its type is supported outright, its rendition (a JPEG, today
 * only ever made for HEIC) when it isn't but one exists, or null when
 * neither is true — the caller falls back to a text note for that image
 * rather than sending a type the model would reject.
 */
function resolveVisionImage(attachment: ConversationAttachment): ResolvedVisionImage | null {
  if (VISION_SUPPORTED_TYPES.has(attachment.contentType)) {
    return { name: attachment.name, url: attachment.url, mimeType: attachment.contentType }
  }
  if (attachment.preview?.renditionUrl) {
    return { name: attachment.name, url: attachment.preview.renditionUrl, mimeType: 'image/jpeg' }
  }
  return null
}

/** Map thread turns to model messages, attaching customer images per the vision gate. */
export function buildThreadModelMessages(
  messages: ThreadMessageWithAttachments[],
  opts: { visionCapable: boolean }
): ThreadModelMessage[] {
  return messages.map((m) => {
    const role = m.sender === 'customer' ? ('user' as const) : ('assistant' as const)
    const images = m.sender === 'customer' ? imageAttachments(m.attachments) : []
    if (images.length === 0) return { role, content: m.content }

    if (!opts.visionCapable) {
      const note = `[image attached: ${images.map((i) => i.name).join(', ')}]`
      return { role, content: m.content ? `${m.content}\n${note}` : note }
    }

    const resolved = images.map((image) => resolveVisionImage(image))
    const usable = resolved.filter((r): r is ResolvedVisionImage => r !== null)
    const skipped = images.filter((_, i) => resolved[i] === null)

    if (usable.length === 0) {
      const note = `[image attached: ${skipped.map((i) => i.name).join(', ')}]`
      return { role, content: m.content ? `${m.content}\n${note}` : note }
    }

    const skippedNote =
      skipped.length > 0 ? `\n[image attached: ${skipped.map((i) => i.name).join(', ')}]` : ''
    const text =
      (m.content || 'The customer sent an image with no accompanying text.') + skippedNote

    return {
      role,
      content: [
        { type: 'text' as const, content: text },
        ...usable.map((image) => ({
          type: 'image' as const,
          source: {
            type: 'url' as const,
            value: resolveImageUrl(image.url),
            mimeType: image.mimeType,
          },
        })),
      ],
    }
  })
}
