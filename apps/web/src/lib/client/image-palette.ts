import { paletteFromPixels } from '@/lib/shared/design/palette'

/** Pixels read along the image's longer side; enough for its main colours. */
const SAMPLE_SIZE = 128

/** The main colours of an image file, read in the browser; empty when it cannot be read. */
export async function imagePalette(file: Blob, count = 5): Promise<string[]> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, SAMPLE_SIZE / Math.max(image.naturalWidth, image.naturalHeight, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return []
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return paletteFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data, count)
  } catch {
    return []
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The longest side of an image sent to Quackback AI to look at. */
const VIEW_SIZE = 1024

/**
 * An image, downscaled and re-encoded as a JPEG data URL, for Quackback AI to
 * look at; null when it cannot be read.
 */
export async function imageForModel(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, VIEW_SIZE / Math.max(image.naturalWidth, image.naturalHeight, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    // A transparent logo sits on white, as it would on a page.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
