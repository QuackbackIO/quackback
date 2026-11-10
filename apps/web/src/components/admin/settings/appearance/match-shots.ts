/**
 * Screenshots dropped to match the brand, read in the browser as Ask AI's
 * composer reads them: each one's colours and the picture the match is
 * made from. Those that cannot be read are left out.
 */
import { readBrandShot } from '@/lib/client/brand-shots'
import { imagePalette } from '@/lib/client/image-palette'
import type { BrandContext, ChatImage } from './use-design-ai'

/** Most screenshots one brand match takes. */
export const MAX_MATCH_SHOTS = 3

export async function readMatchShots(
  files: readonly File[]
): Promise<{ attachments: ChatImage[]; brand: BrandContext | null }> {
  const read = await Promise.all(
    files.slice(0, MAX_MATCH_SHOTS).map(async (file) => {
      const [shot, palette] = await Promise.all([
        readBrandShot(file).catch(() => null),
        imagePalette(file).catch(() => []),
      ])
      return shot ? { shot, palette } : null
    })
  )
  const kept = read.filter((each): each is NonNullable<typeof each> => each !== null)
  if (!kept.length) return { attachments: [], brand: null }
  return {
    attachments: kept.map(({ shot, palette }) => ({ palette, image: shot.jpeg })),
    brand: { shots: kept.map(({ shot }) => shot), name: '', icon: null },
  }
}
