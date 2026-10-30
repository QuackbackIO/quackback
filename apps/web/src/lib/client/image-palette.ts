import { paletteFromPixels } from '@/lib/shared/design/palette'

/** Pixels read along the image's longer side; enough for its main colours. */
const SAMPLE_SIZE = 64

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
