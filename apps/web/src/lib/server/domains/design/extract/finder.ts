/**
 * Element finder: one vision call per screenshot boxes the logo, menu,
 * headline, buttons, hero, header and the rest, and observes what sits behind
 * the headline, the menu style, capitals, the logo's kind, banners and
 * dimming. The model points; image tools measure inside its boxes. Boxes come
 * back in pixels of the image sent, are brought to the full image (a retina
 * capture was halved for the model) and snapped to the elements' real edges.
 *
 * Pure: the model is reached through a `FinderCaller`, so the product calls it
 * through structuredChat (finder-call.ts) and the offline harness through its
 * own client and cache.
 */
import { modelImage, type Image, type ModelImage } from './image'
import { BOX_KINDS, type Box, type BoxKind } from './kinds'
import { finderPrompt, FINDER_VERSION } from './finder-prompt'
import { finderSchema, parseBox, type FinderOutput } from './finder-schema'
import { snapBox } from './snap'

export interface FinderRequest {
  /** The whole instruction, sent as text after the image. */
  prompt: string
  /** The image as the model sees it. */
  png: Uint8Array
  width: number
  height: number
}

/** Asks the model and returns its answer as parsed JSON (validated here). */
export type FinderCaller = (request: FinderRequest) => Promise<unknown>

export interface FoundElements {
  version: string
  /** The model's answer: the words it read, its boxes as written, its observations. */
  output: FinderOutput
  /** Device scale of the image (2 for a retina capture). */
  scale: number
  /** The model's boxes in pixels of the full image, or null when not visible. */
  boxes: Record<BoxKind, Box | null>
  /** The same boxes snapped to the elements' edges. */
  snapped: Record<BoxKind, Box | null>
}

/** The model's boxes in pixels of the full image. */
export function boxesOf(
  output: FinderOutput,
  sent: Image,
  img: Image
): Record<BoxKind, Box | null> {
  const boxes = {} as Record<BoxKind, Box | null>
  for (const k of BOX_KINDS) {
    const f = parseBox(output[k], [sent.width, sent.height])
    boxes[k] = f
      ? [
          Math.round(f[0]! * img.width),
          Math.round(f[1]! * img.height),
          Math.round(f[2]! * img.width),
          Math.round(f[3]! * img.height),
        ]
      : null
  }
  return boxes
}

/**
 * Find the elements in a screenshot. `prepared` is the image as the model
 * gets it, when the caller has made it already (the harness hashes it).
 */
export async function findElements(
  img: Image,
  call: FinderCaller,
  prepared?: ModelImage
): Promise<FoundElements> {
  const m = prepared ?? modelImage(img)
  const answer = await call({
    prompt: finderPrompt(m.image.width, m.image.height),
    png: m.png,
    width: m.image.width,
    height: m.image.height,
  })
  const output = finderSchema.parse(answer)
  const boxes = boxesOf(output, m.image, img)
  const snapped = {} as Record<BoxKind, Box | null>
  for (const k of BOX_KINDS) snapped[k] = snapBox(img, k, boxes[k], { scale: m.scale })
  return { version: FINDER_VERSION, output, scale: m.scale, boxes, snapped }
}
