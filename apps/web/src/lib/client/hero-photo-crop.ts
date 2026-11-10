/**
 * A hero photo cut again from the photo it was taken from (stored with it by
 * a brand match), as a JPEG file to upload in its place.
 */
import type { ShotBox } from '@/lib/shared/design/brand-shots'

/** The box in whole pixels of an image this size, at least one pixel each way. */
export function pixelBox(box: ShotBox, width: number, height: number) {
  const x = Math.max(0, Math.min(width - 1, Math.round(box.x * width)))
  const y = Math.max(0, Math.min(height - 1, Math.round(box.y * height)))
  return {
    x,
    y,
    w: Math.max(1, Math.min(width - x, Math.round(box.w * width))),
    h: Math.max(1, Math.min(height - y, Math.round(box.h * height))),
  }
}

export async function cropPhoto(url: string, box: ShotBox): Promise<File> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = url
  await image.decode()
  const { x, y, w, h } = pixelBox(box, image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(image, x, y, w, h, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.88))
  if (!blob) throw new Error('The photo could not be cropped.')
  return new File([blob], 'hero.jpg', { type: 'image/jpeg' })
}
