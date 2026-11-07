import { useState } from 'react'
import { ArrowsRightLeftIcon, ScissorsIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { BrandLogo } from '@/components/admin/settings/appearance/use-design-ai'
import type { ShotBox } from '@/lib/shared/design/brand-shots'
import { MATCH_BRAND } from '@/lib/shared/design/match-brand'
import { IconCrop } from './icon-crop'
import { CROP } from './properties/words'

/** The part of a screenshot a box takes, drawn as a background so nothing is cut ahead of time. */
function CropPreview({ logo }: { logo: BrandLogo }) {
  const { box, shot } = logo
  const aspect = (box.w * shot.width) / Math.max(1, box.h * shot.height)
  return (
    <span
      aria-hidden="true"
      className="block h-10 shrink-0 rounded-md border border-border bg-no-repeat"
      style={{
        aspectRatio: `${aspect}`,
        maxWidth: '10rem',
        backgroundImage: `url(${shot.url})`,
        backgroundSize: `${100 / box.w}% ${100 / box.h}%`,
        backgroundPosition: `${box.w < 1 ? (box.x / (1 - box.w)) * 100 : 0}% ${box.h < 1 ? (box.y / (1 - box.h)) * 100 : 0}%`,
      }}
    />
  )
}

/**
 * The logo a brand match placed, under its reply: the crop it took, and the
 * title beside an icon. Adjust opens the crop box over the screenshot; a
 * wordmark can show as a full logo, which needs no title, or go back.
 */
export function BrandLogoCard({
  logo,
  onChange,
}: {
  logo: BrandLogo
  onChange: (next: { box?: ShotBox; full?: boolean }) => void
}) {
  const [adjusting, setAdjusting] = useState(false)
  const [box, setBox] = useState(logo.box)
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-medium">
        {CROP.logo} · {logo.full ? MATCH_BRAND.logo : MATCH_BRAND.icon}
      </p>
      <div className="flex items-center gap-3">
        <CropPreview logo={logo} />
        {!logo.full && logo.title && <span className="min-w-0 truncate text-sm">{logo.title}</span>}
        <span className="ms-auto flex shrink-0 gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={CROP.crop}
            title={CROP.crop}
            onClick={() => {
              setBox(logo.box)
              setAdjusting(true)
            }}
          >
            <ScissorsIcon className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={logo.full ? MATCH_BRAND.asIcon : MATCH_BRAND.asFullLogo}
            title={logo.full ? MATCH_BRAND.asIcon : MATCH_BRAND.asFullLogo}
            onClick={() => onChange({ full: !logo.full })}
          >
            <ArrowsRightLeftIcon className="size-4" aria-hidden="true" />
          </Button>
        </span>
      </div>
      <Dialog open={adjusting} onOpenChange={setAdjusting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{CROP.crop}</DialogTitle>
            <DialogDescription className="sr-only">{CROP.hint}</DialogDescription>
          </DialogHeader>
          <IconCrop
            url={logo.shot.url}
            width={logo.shot.width}
            height={logo.shot.height}
            box={box}
            onChange={setBox}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdjusting(false)}>
              {MATCH_BRAND.cancel}
            </Button>
            <Button
              onClick={() => {
                setAdjusting(false)
                onChange({ box })
              }}
            >
              {MATCH_BRAND.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
