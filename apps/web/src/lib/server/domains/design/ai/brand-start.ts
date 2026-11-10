/**
 * The whole-look brand match: three looks written from the screenshots, the
 * first, the faithful one, landing in the draft, the others offered as Try
 * another look. The staged brand match
 * (brand-match.ts) runs this only when no screenshot could be read closely,
 * so the person still gets a first look from them.
 */
import type { AppliedDesignChange, UntrustedChanges } from '@/lib/shared/design/apply-changes'
import { designChanges } from '@/lib/shared/design/diff'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { DesignAiResult } from './design-ai'
import { designDirections } from './design-directions'

/** An image sent to match the brand: its colours by area, and the picture. */
export interface BrandImage {
  palette: string[]
  image?: string
}

/** The images' main colours by area, each once, as the hero's fill is checked against. */
const paletteOf = (images: readonly BrandImage[]) =>
  [...new Set(images.flatMap((image) => image.palette))].slice(0, 6)

export async function matchBrand(input: {
  design: PortalDesign
  images: BrandImage[]
  /** The brand's name as its logo shows it, or the workspace's. */
  name: string | null
  hasMark: boolean
  allows: Omit<UntrustedChanges, 'links'>
}): Promise<DesignAiResult> {
  const pictures = input.images.flatMap((image) => (image.image ? [image.image] : []))
  const result = await designDirections({
    design: input.design,
    name: input.name,
    hasMark: input.hasMark,
    words: null,
    images: pictures,
    palette: paletteOf(input.images),
    allows: input.allows,
  })
  if (!result.ok) return result
  const look = result.looks[0]
  if (!look) {
    return {
      ok: false,
      code: 'AI_FAILED',
      message: 'I could not match your brand. Try again.',
    }
  }
  const applied = designChanges(input.design, look.design) as AppliedDesignChange[]
  const from = pictures.length === 1 ? 'your screenshot' : 'your screenshots'
  return {
    ok: true,
    reply: `I matched your brand from ${from}. ${look.description}`,
    design: look.design,
    applied,
    skipped: 0,
    outOfScope: false,
    readability: [],
    // The other looks were written in the same call; offered at no further cost.
    others: result.looks.slice(1).map((other) => ({
      description: other.description,
      changes: designChanges(input.design, other.design) as AppliedDesignChange[],
    })),
  }
}
