/**
 * The element finder in the product: its model call through structuredChat
 * (strict json_schema, no temperature, as Haiku 5.5 on OpenRouter lists none)
 * with the design model, counted against the workspace's AI allowance.
 * Kept apart from finder.ts so the offline harness can load the finder
 * without the app.
 */
import type { ContentPart } from '@tanstack/ai'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { logger } from '@/lib/server/logger'
import { designAiModel, designUsage } from '../ai/design-ai'
import { findElements, type FinderCaller, type FoundElements } from './finder'
import { finderSchema } from './finder-schema'
import { decodeDataUrl, type Image } from './image'

const log = logger.child({ module: 'element-finder' })

/** A finder answer is about 600 tokens; room for long headlines. */
const MAX_TOKENS = 1500

/** The finder's model call through structuredChat: the image, then the prompt. */
export function structuredFinderCaller(model: string): FinderCaller {
  return ({ prompt, png }) => {
    const picture: ContentPart = {
      type: 'image',
      source: { type: 'data', value: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
    }
    return structuredChat({
      model,
      systemPrompts: [],
      messages: [{ role: 'user', content: [picture, { type: 'text', content: prompt }] }],
      schema: finderSchema,
      maxTokens: MAX_TOKENS,
      middleware: designUsage(model, 'elements'),
    })
  }
}

/**
 * The elements in a screenshot (a data URL, PNG or JPEG, or decoded pixels),
 * or null when no AI is set up or the screenshot cannot be read.
 */
export async function findScreenshotElements(
  screenshot: string | Image,
  model: string | null = designAiModel()
): Promise<FoundElements | null> {
  if (!model) return null
  let img: Image
  try {
    img = typeof screenshot === 'string' ? decodeDataUrl(screenshot) : screenshot
  } catch (err) {
    log.warn({ err }, 'element finder could not decode the screenshot')
    return null
  }
  try {
    return await findElements(img, structuredFinderCaller(model))
  } catch (err) {
    log.warn(
      { err, width: img.width, height: img.height },
      'element finder could not read the screenshot'
    )
    return null
  }
}
