/**
 * A hero image made ready in the browser before it is stored: no wider than
 * a wide screen needs, and smaller WebP copies for smaller screens, which the
 * portal offers by width. Anything it cannot read or redraw goes up as it is.
 */

/** The widest a hero image is stored. */
export const HERO_MAX_WIDTH = 2560
/** The widths of the smaller copies, where the image is wider. */
export const HERO_COPY_WIDTHS = [640, 1280] as const
/** WebP and JPEG quality: photos stay sharp, files stay light. */
export const HERO_QUALITY = 0.82
/** Types redrawn; a GIF may move and an SVG has no pixels to scale. */
const REDRAWN = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** What an image of a size is stored as: its width (smaller when too wide) and its copies' widths. */
export function heroPlan(width: number, height: number) {
  const scale = Math.min(1, HERO_MAX_WIDTH / Math.max(width, 1))
  const stored = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
  return {
    stored,
    /** Whether the image itself is redrawn smaller. */
    scaled: scale < 1,
    // A copy close to the image's own width saves too little to be worth a file.
    copies: HERO_COPY_WIDTHS.filter((w) => w <= stored.width * 0.8),
  }
}

export interface PreparedHero {
  /** The image to store: the upload itself, or a smaller redraw of it. */
  file: File
  /** Its width in pixels, when it could be read. */
  width: number | null
  /** The smaller WebP copies, by width. */
  copies: Array<{ file: File; width: number }>
}

/** The image redrawn at a width, keeping its shape, as one of the types asked for in order. */
async function redraw(
  image: HTMLImageElement,
  width: number,
  name: string,
  types: ReadonlyArray<'image/webp' | 'image/jpeg'>
): Promise<File | null> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.max(1, Math.round((image.naturalHeight * width) / image.naturalWidth))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  for (const type of types) {
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, HERO_QUALITY))
    // A browser that cannot write the type hands back a PNG instead.
    if (blob?.type === type)
      return new File([blob], `${name}.${type === 'image/webp' ? 'webp' : 'jpg'}`, { type })
  }
  return null
}

export async function prepareHeroImage(file: File): Promise<PreparedHero> {
  if (!REDRAWN.has(file.type)) return { file, width: null, copies: [] }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) return { file, width: null, copies: [] }
    const plan = heroPlan(image.naturalWidth, image.naturalHeight)
    const base = file.name.replace(/\.[^.]+$/, '') || 'hero'
    // A JPEG may fall back to JPEG; a PNG or WebP may hold transparency, which JPEG would lose.
    const fallbacks =
      file.type === 'image/jpeg'
        ? (['image/webp', 'image/jpeg'] as const)
        : (['image/webp'] as const)
    const smaller = plan.scaled ? await redraw(image, plan.stored.width, base, fallbacks) : null
    const copies: PreparedHero['copies'] = []
    for (const width of plan.copies) {
      const copy = await redraw(image, width, `${base}-${width}`, ['image/webp'])
      if (copy) copies.push({ file: copy, width })
    }
    if (plan.scaled && !smaller) return { file, width: image.naturalWidth, copies }
    return { file: smaller ?? file, width: plan.stored.width, copies }
  } catch {
    return { file, width: null, copies: [] }
  } finally {
    URL.revokeObjectURL(url)
  }
}
