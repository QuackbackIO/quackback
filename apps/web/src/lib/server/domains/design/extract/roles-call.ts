/**
 * The colour roles classifier in the product: its model call through
 * structuredChat (strict json_schema, no temperature) with the design model,
 * counted against the workspace's AI allowance. Kept apart from
 * roles-classifier.ts so the offline harness can load the classifier
 * without the app.
 */
import type { ContentPart } from '@tanstack/ai'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { designUsage } from '../ai/design-ai'
import { rolesSchema, type RolesCaller } from './roles-classifier'

/** An answer is about 150 tokens; room for the evidence sentence. */
// Haiku's reasoning counts towards the limit; a low one cuts the answer mid-JSON.
const MAX_TOKENS = 2000

/** The classifier's model call through structuredChat: the logo crop, then the prompt. */
export function structuredRolesCaller(model: string): RolesCaller {
  return ({ prompt, images }) => {
    const pictures: ContentPart[] = images.map((im) => ({
      type: 'image',
      source: { type: 'data', value: Buffer.from(im.data).toString('base64'), mimeType: im.mime },
    }))
    return structuredChat({
      model,
      systemPrompts: [],
      messages: [{ role: 'user', content: [...pictures, { type: 'text', content: prompt }] }],
      schema: rolesSchema,
      maxTokens: MAX_TOKENS,
      middleware: designUsage(model, 'roles'),
    })
  }
}
