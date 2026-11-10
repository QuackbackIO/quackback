import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ShotBox } from '@/lib/shared/design/brand-shots'
import { MATCH_BRAND } from '@/lib/shared/design/match-brand'
import { IconCrop } from './icon-crop'

/**
 * Cropping a hero photo again: the photo it was cut from, with the crop box
 * over it (the logo's crop box), saved as a new crop.
 */
export function HeroPhotoCrop({
  open,
  onOpenChange,
  source,
  box,
  busy = false,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where the photo the crop was cut from is shown from. */
  source: string
  box: ShotBox
  busy?: boolean
  onSave: (box: ShotBox) => void
}) {
  const [edit, setEdit] = useState(box)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    if (open) setEdit(box)
  }, [open, box])
  useEffect(() => {
    if (!open) return
    const image = new Image()
    image.onload = () => setSize({ width: image.naturalWidth, height: image.naturalHeight })
    image.src = source
    return () => {
      image.onload = null
    }
  }, [open, source])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{MATCH_BRAND.adjustCrop}</DialogTitle>
          <DialogDescription>{MATCH_BRAND.adjustCropHint}</DialogDescription>
        </DialogHeader>
        {size ? (
          <IconCrop
            url={source}
            width={size.width}
            height={size.height}
            box={edit}
            onChange={setEdit}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Loading the photo…</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {MATCH_BRAND.cancel}
          </Button>
          <Button disabled={!size || busy} onClick={() => onSave(edit)}>
            {busy ? 'Saving…' : MATCH_BRAND.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
