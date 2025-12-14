'use client'

import { useState, useCallback } from 'react'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ZoomIn } from 'lucide-react'

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

  // Convert to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to create blob'))
        }
      },
      'image/jpeg',
      0.9
    )
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
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

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
            cropShape={cropShape}
            showGrid={cropShape === 'rect'}
          />
        </div>

        <div className="flex items-center gap-3 px-1">
          <ZoomIn className="h-4 w-4 text-muted-foreground shrink-0" />
          <Slider
            value={[zoom]}
            min={1}
            max={3}
            step={0.1}
            onValueChange={(value) => setZoom(value[0])}
            className="flex-1"
          />
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
