/**
 * Rasterize a square image blob down to `size`×`size` PNG. Used to derive a
 * favicon from the cropped workspace logo (already square, ≤512px).
 */
export async function downscaleSquareImage(blob: Blob, size: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get canvas context')
    ctx.drawImage(bitmap, 0, 0, size, size)
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!out) throw new Error('Failed to encode image')
    return out
  } finally {
    bitmap.close()
  }
}
