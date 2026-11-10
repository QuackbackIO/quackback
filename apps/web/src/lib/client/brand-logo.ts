/**
 * The logo a brand start places: the mark cut from a screenshot, stored for
 * the design, and put in the draft as the icon beside the title, or as the
 * full logo when the mark is a wordmark.
 */
import { getWordmarkUploadUrlFn } from '@/lib/server/functions/uploads'
import type { ShotBox } from '@/lib/shared/design/brand-shots'
import { setIcon, setLogoInk, setTitle, showFullLogo } from '@/lib/shared/design/logo'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cropShot, type BrandShot } from './brand-shots'
import { imageInk } from './image-palette'

/** Puts a file into storage for the design, and gives its key. */
async function store(file: File): Promise<string> {
  const { uploadUrl, key } = await getWordmarkUploadUrlFn({
    data: { filename: file.name, contentType: file.type, fileSize: file.size },
  })
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (!put.ok) throw new Error('The logo could not be uploaded.')
  return key
}

/**
 * The change that places a logo cut from a screenshot: as a full logo image,
 * which shows the name itself, or as the icon with the title beside it.
 */
export async function brandLogoChange(
  shot: BrandShot,
  box: ShotBox,
  options: { full: boolean; title: string | null }
): Promise<(draft: PortalDesign) => void> {
  const file = await cropShot(shot, box)
  const [key, ink] = await Promise.all([store(file), imageInk(file)])
  return (draft) => {
    if (options.full) {
      draft.brand.logo.wordmark.light = { key }
      showFullLogo(draft, true)
      setLogoInk(draft.brand.logo, ink)
      return
    }
    showFullLogo(draft, false)
    setIcon(draft, { key }, ink)
    if (options.title) setTitle(draft, options.title)
  }
}
