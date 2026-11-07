/**
 * Screenshots of a brand's site or app, read for what their pixels cannot
 * say: the brand's name, where its mark sits (a crop box the icon starts
 * from), and which images a cookie banner covers or a pop-up dims, so a
 * clean screenshot can be asked for and a banner's buttons never count as
 * brand colours.
 */
import { z } from 'zod'
import type { ContentPart } from '@tanstack/ai'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { logger } from '@/lib/server/logger'
import type { ShotBox } from '@/lib/shared/design/brand-shots'
import { CONSENT_WORDS } from '../site/consent'
import { designUsage } from './design-ai'

const log = logger.child({ module: 'shot-read' })

/** Flat, as nested objects grow the grammar a strict answer is held to. */
export const shotReadSchema = z.object({
  /** The brand's name as its logo or page shows it. */
  name: z.string(),
  /** The image that shows the brand's mark best, or -1. */
  iconImage: z.number(),
  iconX: z.number(),
  iconY: z.number(),
  iconW: z.number(),
  iconH: z.number(),
  /** The mark is the brand's name set as a logo, with no symbol of its own. */
  iconWordmark: z.boolean(),
  /** The words a cookie or consent banner shows, as written; "" when none shows. Read first, so the image is named from what it says. */
  bannerText: z.string(),
  /** The image a cookie or consent banner covers part of, or -1. */
  bannerImage: z.number(),
  bannerX: z.number(),
  bannerY: z.number(),
  bannerW: z.number(),
  bannerH: z.number(),
  /** Images dimmed by a pop-up's dark layer over the page. */
  dimmedImages: z.array(z.number()).max(3),
})
type Answer = z.infer<typeof shotReadSchema>

export interface ShotRead {
  name: string
  icon: { image: number; box: ShotBox; wordmark: boolean } | null
  banners: Array<{ image: number; box: ShotBox }>
  dimmed: number[]
}

/** A box held inside its image. */
function boxOf(x: number, y: number, w: number, h: number): ShotBox {
  const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
  const x0 = clamp(x)
  const y0 = clamp(y)
  const round = (v: number) => Math.round(v * 1000) / 1000
  return {
    x: round(x0),
    y: round(y0),
    w: round(clamp(x + w) - x0),
    h: round(clamp(y + h) - y0),
  }
}

/*
 * The read names a banner only when its own quoted words say so (CONSENT_WORDS):
 * a chat window, a sign-up box or an advert in a corner was named a banner on
 * some reads and not others.
 */

/** Smaller than this share of an image's side, a box is a guess, not a mark. */
const MIN_ICON = 0.005

/** The model's answer held to the images given. */
export function shotRead(answer: Answer, images: number): ShotRead {
  const given = (index: number) => Number.isInteger(index) && index >= 0 && index < images
  const icon = boxOf(answer.iconX, answer.iconY, answer.iconW, answer.iconH)
  const banner = boxOf(answer.bannerX, answer.bannerY, answer.bannerW, answer.bannerH)
  return {
    name: answer.name.trim().slice(0, 60),
    icon:
      given(answer.iconImage) && icon.w >= MIN_ICON && icon.h >= MIN_ICON
        ? { image: answer.iconImage, box: icon, wordmark: answer.iconWordmark }
        : null,
    banners:
      given(answer.bannerImage) &&
      banner.w > 0 &&
      banner.h > 0 &&
      CONSENT_WORDS.test(answer.bannerText)
        ? [{ image: answer.bannerImage, box: banner }]
        : [],
    dimmed: [...new Set(answer.dimmedImages.filter(given))],
  }
}

const PROMPT = `You look at one to three images a company gave to brand its customer portal: screenshots of their website or app, or brand guidelines. Images are numbered from 0 in the order given. Answer:
- name: the brand's name as its logo shows it, such as "Petalpost"; "" if none shows.
- iconImage and iconX, iconY, iconW, iconH: the image and the box around the brand's mark, the small symbol or logo at the start of the header (or on the guidelines), as fractions of that image's width and height from its top left. Fit the box to the mark with a little room; take the symbol alone when the logo has one beside its name, else the whole logo. -1 and zeros when there is none.
- iconWordmark: true when the logo is the brand's name set in type with no symbol of its own (a wordmark), such as a name in bold capitals on a coloured block.
- bannerText: the words on a cookie or consent banner (one asking to accept or manage cookies or privacy choices), quoted as written; "" when there is none. A chat window, a sign-up or newsletter box or an advert is not one.
- bannerImage and bannerX, bannerY, bannerW, bannerH: the image that cookie or consent banner covers part of, and the box around the banner. -1 and zeros when there is none.
- dimmedImages: images whose page is darkened by a pop-up's dark layer, so its colours look dimmer than they are.`

/** The images read, or null when they could not be. */
export async function readShots(model: string, images: string[]): Promise<ShotRead | null> {
  const parts: ContentPart[] = images.map((image) => ({
    type: 'image',
    source: {
      type: 'data',
      value: image.replace(/^data:image\/jpeg;base64,/, ''),
      mimeType: 'image/jpeg',
    },
  }))
  try {
    const answer = await structuredChat({
      model,
      systemPrompts: [PROMPT],
      messages: [
        { role: 'user', content: [{ type: 'text', content: 'Read these images.' }, ...parts] },
      ],
      schema: shotReadSchema,
      maxTokens: 1500,
      middleware: designUsage(model, 'shots'),
    })
    return shotRead(answer, images.length)
  } catch (err) {
    log.warn({ err }, 'design ai could not read the screenshots')
    return null
  }
}
