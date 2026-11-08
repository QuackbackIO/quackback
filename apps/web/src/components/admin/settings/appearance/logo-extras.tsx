import { imageInk, imagePalette } from '@/lib/client/image-palette'
import { setIcon } from '@/lib/shared/design/logo'
import type { PortalDesign } from '@/lib/shared/design/schema'

type Update = (change: (draft: PortalDesign) => void) => void

/** A logo as it is uploaded: its ink, and its own colours (up to six), read once. */
export async function readLogo(file: File) {
  const [ink, colours] = await Promise.all([
    imageInk(file),
    imagePalette(file, 6).catch(() => [] as string[]),
  ])
  return { ink, colours: colours.map((colour) => colour.toLowerCase()).slice(0, 6) }
}

/** A new logo's colours as the brand's logo colours, which the brand colour row offers. */
export function setLogoColours(draft: PortalDesign, colours: readonly string[]) {
  if (colours.length) draft.brand.logoColours = [...colours]
}

/**
 * An uploaded icon into the draft, with its ink so it reads on any header
 * and its colours as the logo colours, in one step.
 */
export async function draftIcon(update: Update, key: string, file: File) {
  const { ink, colours } = await readLogo(file)
  update((draft) => {
    setIcon(draft, { key }, ink)
    setLogoColours(draft, colours)
  })
}
