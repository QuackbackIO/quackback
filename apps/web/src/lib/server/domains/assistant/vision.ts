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
 *      message) followed by one image part per image attachment. Image URLs
 *      from the upload pipeline are absolutized from the immutable system
 *      host, since the provider fetches the URL itself (a relative
 *      `/api/storage/...` path is meaningless off-host).
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

    return {
      role,
      content: [
        {
          type: 'text' as const,
          content: m.content || 'The customer sent an image with no accompanying text.',
        },
        ...images.map((image) => ({
          type: 'image' as const,
          source: {
            type: 'url' as const,
            value: resolveImageUrl(image.url),
            mimeType: image.contentType,
          },
        })),
      ],
    }
  })
}
