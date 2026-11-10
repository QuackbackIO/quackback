import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { nearestBundledFont } from '@/lib/shared/design/font-match'
import { BUNDLED_FONTS, closestWeight } from '@/lib/shared/design/fonts'
import type { PortalDesign } from '@/lib/shared/design/schema'

type Update = (change: (draft: PortalDesign) => void) => void

/** The id of the own-font upload, which this opens. */
export const OWN_FONT_ID = 'own-font'

/**
 * The brand's own face by name, and the bundled face closest to it, to use
 * in a click, with the upload for an exact match beside it.
 */
export function ClosestFace({ update }: { update: Update }) {
  const [name, setName] = useState('')
  const typed = name.trim()
  const nearest = typed ? nearestBundledFont(typed) : null
  const openUpload = () => {
    const details = document.getElementById(OWN_FONT_ID)
    if (details instanceof HTMLDetailsElement) {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
      details.scrollIntoView({ block: 'nearest' })
    }
  }
  return (
    <div className="space-y-2 text-[13px]">
      <div className="flex items-center gap-2">
        <label htmlFor="brand-font-name" className="w-32 shrink-0">
          Your brand’s font
        </label>
        <Input
          id="brand-font-name"
          className="h-8 flex-1"
          placeholder="Its name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      {typed && (
        <div className="space-y-2 text-muted-foreground">
          <p>
            {nearest
              ? `Closest free face to ${typed}: ${BUNDLED_FONTS[nearest].label}.`
              : 'No close free face known.'}{' '}
            For an exact match, upload your own font files.
          </p>
          <div className="flex flex-wrap gap-2">
            {nearest && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    update((draft) => {
                      const fonts = draft.brand.fonts
                      fonts.heading = { kind: 'bundled', id: nearest }
                      fonts.headingWeight = closestWeight(fonts.heading, fonts.headingWeight)
                    })
                  }
                >
                  Use for headings
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    update(
                      (draft) => void (draft.brand.fonts.body = { kind: 'bundled', id: nearest })
                    )
                  }
                >
                  Use for body
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={openUpload}>
              Upload your own
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
