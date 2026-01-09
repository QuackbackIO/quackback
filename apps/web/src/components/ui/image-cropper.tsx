import { useState, useCallback, useEffect } from 'react'
import Cropper from 'react-easy-crop'
import type { Area, MediaSize } from 'react-easy-crop'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon } from '@heroicons/react/24/solid'

interface ImageCropperProps {
  imageSrc: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCropComplete: (blob: Blob) => void
  aspectRatio?: number
  maxOutputSize?: number
  /** Dialog title (defaults to "Crop your image") */
  title?: string
  /** Crop shape - 'round' for avatars/logos, 'rect' for landscape images */
  cropShape?: 'round' | 'rect'
}

/**
 * Creates a cropped image from the source image
 * Supports both square and non-square aspect ratios
 */
async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  maxSize: number = 512,
  aspectRatio: number = 1
): Promise<Blob> {
  const image = new Image()
  image.crossOrigin = 'anonymous'

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = reject
    image.src = imageSrc
  })

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Could not get canvas context')
  }

  // Calculate output dimensions based on aspect ratio
  // maxSize is the constraint for the largest dimension
  let outputWidth: number
  let outputHeight: number

  if (aspectRatio >= 1) {
    // Landscape or square: width is the larger dimension
    outputWidth = Math.min(pixelCrop.width, maxSize)
    outputHeight = outputWidth / aspectRatio
  } else {
    // Portrait: height is the larger dimension
    outputHeight = Math.min(pixelCrop.height, maxSize)
    outputWidth = outputHeight * aspectRatio
  }

  canvas.width = Math.round(outputWidth)
  canvas.height = Math.round(outputHeight)

  // Draw the cropped image
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    canvas.width,
    canvas.height
  )

  // Convert to blob (PNG to preserve transparency)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Failed to create blob'))
      }
    }, 'image/png')
  })
}

export function ImageCropper({
  imageSrc,
  open,
  onOpenChange,
  onCropComplete,
  aspectRatio = 1,
  maxOutputSize = 512,
  title = 'Crop your image',
  cropShape = 'round',
}: ImageCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [minZoom, setMinZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // Calculate optimal minZoom when media loads so image can fit entirely
  const onMediaLoaded = useCallback(
    (mediaSize: MediaSize) => {
      const imageAspect = mediaSize.naturalWidth / mediaSize.naturalHeight

      // Calculate the zoom level needed to fit the entire image in the crop area
      // When image is wider than crop area, we need to zoom out more
      // When image is taller than crop area, we also need to zoom out
      let calculatedMinZoom: number
      if (imageAspect > aspectRatio) {
        // Image is wider than crop area - need to zoom out to see full width
        calculatedMinZoom = aspectRatio / imageAspect
      } else {
        // Image is taller than crop area - need to zoom out to see full height
        calculatedMinZoom = imageAspect / aspectRatio
      }

      // Allow 50% extra zoom out for more flexibility, clamped to 0.1 minimum
      const minZoomWithBuffer = Math.max(0.1, calculatedMinZoom * 0.5)
      setMinZoom(minZoomWithBuffer)

      // Start at the "fit" level (image fully visible) but allow zooming out further
      setZoom(calculatedMinZoom)
      setCrop({ x: 0, y: 0 })
    },
    [aspectRatio]
  )

  // Reset state when dialog opens with new image
  useEffect(() => {
    if (open) {
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setMinZoom(1)
      setCroppedAreaPixels(null)
    }
  }, [open, imageSrc])

  const onCropChange = useCallback((location: { x: number; y: number }) => {
    setCrop(location)
  }, [])

  const onZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom)
  }, [])

  const onCropCompleteCallback = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const handleApply = async () => {
    if (!croppedAreaPixels) return

    setIsProcessing(true)
    try {
      const croppedBlob = await getCroppedImg(
        imageSrc,
        croppedAreaPixels,
        maxOutputSize,
        aspectRatio
      )
      onCropComplete(croppedBlob)
      onOpenChange(false)
    } catch (error) {
      console.error('Error cropping image:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
    // Reset state for next use
    setCrop({ x: 0, y: 0 })
    setZoom(1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="relative h-64 w-full bg-muted rounded-lg overflow-hidden">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspectRatio}
            onCropChange={onCropChange}
            onZoomChange={onZoomChange}
            onCropComplete={onCropCompleteCallback}
            onMediaLoaded={onMediaLoaded}
            cropShape={cropShape}
            showGrid={cropShape === 'rect'}
            minZoom={minZoom}
            restrictPosition={zoom >= 1}
            zoomSpeed={0.2}
          />
        </div>

        <div className="flex items-center gap-3 px-1">
          <MagnifyingGlassMinusIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <Slider
            value={[zoom]}
            min={minZoom}
            max={3}
            step={0.1}
            onValueChange={(value) => setZoom(value[0])}
            className="flex-1"
          />
          <MagnifyingGlassPlusIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel} disabled={isProcessing}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={isProcessing || !croppedAreaPixels}>
            {isProcessing ? 'Processing...' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
