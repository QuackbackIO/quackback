/**
 * A brand match's model calls and storage in the product: the element finder
 * and the colour roles classifier through their own callers, the decision
 * families through structuredChat (strict json_schema, no temperature, the
 * design model, counted against the workspace's AI allowance), the logo
 * cutout stored as a header logo, a hero photo cut from a screenshot stored
 * as a hero image, images from the brand's site stored as logos, and the
 * previous whole-look match as the
 * fallback when no screenshot can be read.
 */
import type { ContentPart } from '@tanstack/ai'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { createUsageLoggingMiddleware } from '@/lib/server/domains/ai/usage-middleware'
import { logger } from '@/lib/server/logger'
import { findElements } from '../extract/finder'
import { structuredFinderCaller } from '../extract/finder-call'
import { structuredRolesCaller } from '../extract/roles-call'
import type { FamilyCaller } from './brand-brief'
import type { BrandMatchDeps } from './brand-match'

const log = logger.child({ module: 'brand-calls' })

/** One decision family's call: its crops, then its prompt; validated against its schema. */
export function structuredFamilyCaller(model: string): FamilyCaller {
  return (request) => {
    const pictures: ContentPart[] = request.images.map((image) => ({
      type: 'image',
      source: {
        type: 'data',
        value: Buffer.from(image.data).toString('base64'),
        mimeType: image.mime,
      },
    }))
    return structuredChat({
      model,
      systemPrompts: [],
      messages: [
        { role: 'user', content: [...pictures, { type: 'text', content: request.prompt }] },
      ],
      schema: request.schema,
      maxTokens: request.maxTokens,
      middleware: [
        createUsageLoggingMiddleware({
          pipelineStep: 'design',
          model,
          metadata: { call: `brand-${request.family}`, version: request.version },
        }),
      ],
    }) as Promise<never>
  }
}

/** Stores a logo cutout where header logos go, giving its key; null without storage. */
export async function storeLogo(png: Uint8Array): Promise<string | null> {
  const { generateStorageKey, isS3Usable, uploadObject } = await import('@/lib/server/storage/s3')
  if (!isS3Usable()) return null
  const key = generateStorageKey('header-logos', 'logo.png')
  try {
    await uploadObject(key, png, 'image/png')
    return key
  } catch (err) {
    log.warn({ err }, 'brand match could not store the logo')
    return null
  }
}

/** Stores a hero photo cut from a screenshot where hero images go, giving its key; null without storage. */
export async function storePhoto(jpeg: Uint8Array, name: string): Promise<string | null> {
  const { generateStorageKey, isS3Usable, uploadObject } = await import('@/lib/server/storage/s3')
  if (!isS3Usable()) return null
  const key = generateStorageKey('portal-images', name)
  try {
    await uploadObject(key, jpeg, 'image/jpeg')
    return key
  } catch (err) {
    log.warn({ err }, 'brand match could not store the hero photo')
    return null
  }
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/x-icon': 'ico',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

/**
 * Stores an image from the brand's own site (its favicon, logo file or share
 * picture) where logos go, giving its key; null without storage. An SVG is
 * already sanitised by the site reader.
 */
export async function storeAsset(
  bytes: Uint8Array,
  mime: string,
  kind: 'favicon' | 'logo' | 'share'
): Promise<string | null> {
  const { generateStorageKey, isS3Usable, uploadObject } = await import('@/lib/server/storage/s3')
  if (!isS3Usable()) return null
  const key = generateStorageKey('logos', `${kind}.${EXT[mime] ?? 'png'}`)
  try {
    await uploadObject(key, bytes, mime)
    return key
  } catch (err) {
    log.warn({ err, kind }, 'brand match could not store a site image')
    return null
  }
}

/** The product's calls for a brand match, with the design model. */
export function brandMatchDeps(
  model: string,
  fallback: BrandMatchDeps['fallback']
): BrandMatchDeps {
  const finder = structuredFinderCaller(model)
  return {
    find: (img) => findElements(img, finder),
    roles: structuredRolesCaller(model),
    family: structuredFamilyCaller(model),
    storeLogo,
    storePhoto,
    storeAsset,
    fallback,
  }
}
