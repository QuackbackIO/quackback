import { useCallback, useEffect, useMemo, useState } from 'react'
import { trackBuilder } from '@/lib/client/builder-events'
import type { BrandShot } from '@/lib/client/brand-shots'
import { readBrandShotsFn } from '@/lib/server/functions/portal-design-ai'
import { shotWarnings } from '@/lib/shared/design/match-brand'
import type { BrandContext, ShotsRead } from './use-design-ai'

/**
 * The checks on screenshots attached to a chat message, before it is sent:
 * each is read in the browser for a pop-up's dimming, and the set once by
 * Quackback AI for the brand's name, its mark and any cookie banner. A warned
 * one holds the message until it is removed or kept anyway.
 */
export function useShotChecks(attached: ReadonlyArray<{ id: number; shot?: BrandShot | null }>) {
  const key = attached.map((item) => item.id).join(',')
  const shots = useMemo(
    () => attached.flatMap((item) => (item.shot ? [item.shot] : [])),
    [attached]
  )
  const screenshots = attached.length > 0 && shots.length === attached.length
  const [read, setRead] = useState<(ShotsRead & { key: string }) | null>(null)
  // The set of images last settled, answered or failed. Whether the check is
  // still running is derived from it, so no flag can be left set by a request
  // that was superseded, or by images removed while it was out.
  const [settled, setSettled] = useState<string | null>(null)
  const [kept, setKept] = useState<ReadonlySet<number>>(new Set())

  useEffect(() => {
    if (!screenshots) return
    // Each run answers for its own set of images only; a later run (or an
    // unmount) retires it, and the later run settles the check.
    let live = true
    readBrandShotsFn({ data: { images: shots.map((shot) => shot.jpeg) } })
      .then((result) => {
        if (live && 'read' in result && result.read) setRead({ key, ...result.read })
      })
      .catch(() => {})
      .finally(() => {
        if (live) setSettled(key)
      })
    return () => {
      live = false
    }
    // `key` names `shots`, so the run is for the images, not their array.
  }, [shots, screenshots, key])

  const reading = screenshots && settled !== key
  const fresh = screenshots && read?.key === key ? read : null
  const keptAt = new Set(attached.flatMap((item, index) => (kept.has(item.id) ? [index] : [])))
  const warnings = screenshots ? shotWarnings(shots, fresh, keptAt) : attached.map(() => null)

  const keep = useCallback(
    (id: number) => {
      const warning = warnings[attached.findIndex((item) => item.id === id)]
      if (warning) trackBuilder('designer_chat_shot_kept', { warning })
      setKept((now) => new Set([...now, id]))
    },
    [warnings, attached]
  )

  /** The screenshots as a brand start places its logo from them, when every image is one. */
  const brand = (): BrandContext | null =>
    screenshots
      ? {
          shots,
          name: fresh?.name ?? '',
          icon: fresh?.icon ?? null,
          // Every warning, kept or not: a kept dimmed one is still read as dimmed.
          warnings: shotWarnings(shots, fresh, new Set()),
        }
      : null

  return { warnings, reading, keep, brand }
}
