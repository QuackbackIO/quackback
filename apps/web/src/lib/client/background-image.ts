import { imageTones } from '@/lib/shared/design/page-background'

/** The longest side a page background is stored at, and a phone's copy. */
const FULL_SIZE = 2400
const PHONE_SIZE = 1080
/** Pixels read along the longer side to measure its tones. */
const TONE_SIZE = 96

export interface PreparedBackground {
  /** The image for larger screens, no larger than it needs to be. */
  full: File
  /** A smaller copy for phones, when the image is larger than a phone needs. */
  phone: File | null
  /** Its darkest and lightest tones, for the layer that keeps text readable. */
  tones: [string, string] | null
}

/** An image redrawn with its longer side at most `size`, as WebP (or JPEG where WebP cannot be written). */
async function scaled(image: HTMLImageElement, size: number, name: string): Promise<File | null> {
  const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight, 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  for (const type of ['image/webp', 'image/jpeg'] as const) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82))
    if (blob?.type === type)
      return new File([blob], `${name}.${type === 'image/webp' ? 'webp' : 'jpg'}`, { type })
  }
  return null
}

/**
 * An uploaded page background, made ready in the browser: stored no larger
 * than a wide screen needs, with a phone's copy, and its tones measured.
 * Anything it cannot read goes up as it is, with no tones.
 */
export async function prepareBackgroundImage(file: File): Promise<PreparedBackground> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const base = file.name.replace(/\.[^.]+$/, '') || 'background'
    const longest = Math.max(image.naturalWidth, image.naturalHeight)
    const full = longest > FULL_SIZE ? await scaled(image, FULL_SIZE, base) : null
    const phone = longest > PHONE_SIZE ? await scaled(image, PHONE_SIZE, `${base}-phone`) : null
    const toneScale = Math.min(1, TONE_SIZE / Math.max(longest, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * toneScale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * toneScale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    let tones: [string, string] | null = null
    if (context) {
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      tones = imageTones(context.getImageData(0, 0, canvas.width, canvas.height).data)
    }
    return { full: full ?? file, phone, tones }
  } catch {
    return { full: file, phone: null, tones: null }
  } finally {
    URL.revokeObjectURL(url)
  }
}
