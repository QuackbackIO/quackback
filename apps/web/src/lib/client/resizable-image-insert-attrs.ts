/**
 * Attrs for inserting a `resizableImage` node after upload.
 *
 * `tiptap-extension-resizable-image` defaults missing width/height to 500×500.
 * We probe the file's natural size and store a proportional box (capped at the
 * extension's default width) so the serializer does not emit a 1:1 aspect-ratio.
 */
const MAX_INSERT_WIDTH = 500

export function scaleImageInsertSize(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth = MAX_INSERT_WIDTH
): { width: number; height: number } {
  if (naturalWidth <= maxWidth) {
    return { width: naturalWidth, height: naturalHeight }
  }
  return {
    width: maxWidth,
    height: Math.max(1, Math.round((maxWidth * naturalHeight) / naturalWidth)),
  }
}

function naturalImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    image.src = url
  })
}

export async function resizableImageInsertAttrs(
  src: string,
  file: File
): Promise<{ src: string; 'data-keep-ratio': true; width?: number; height?: number }> {
  try {
    const { width, height } = await naturalImageSize(file)
    if (width < 1 || height < 1) throw new Error('invalid image size')
    return { src, 'data-keep-ratio': true, ...scaleImageInsertSize(width, height) }
  } catch {
    return { src, 'data-keep-ratio': true }
  }
}
