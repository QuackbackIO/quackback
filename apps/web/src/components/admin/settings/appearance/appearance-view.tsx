import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ClientOnly } from '@tanstack/react-router'
import type { PortalDesignRevisionId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/ui/time-ago'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { restorePortalDesignVersionFn } from '@/lib/server/functions/portal-design'
import { designChanges } from '@/lib/shared/design/diff'
import { BUNDLED_FONTS } from '@/lib/shared/design/fonts'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { portalPreviewSrc } from '@/components/admin/settings/branding/portal-preview'
import { HistoryDialog } from './history-dialog'

/** The width a desktop visitor's browser lays the portal out at. */
const DESKTOP_WIDTH = 1280

/** The builder, and its Brand kit's match row. */
export const BUILDER_HREF = '/design?path=%2F&from=appearance'
export const MATCH_HREF = `${BUILDER_HREF}&brand=match`

/** A design's colours to show as swatches: the brand's own, before the page and text. */
export function brandSwatches(design: PortalDesign): string[] {
  const { accent, support, extra, background, ink } = design.brand.light
  return [accent, support, ...(extra ?? []), background, ink].filter(
    (colour): colour is string => !!colour
  )
}

/** A design's font names, the heading's first, each once. */
export function brandFonts(design: PortalDesign): string[] {
  const { heading, body, display } = design.brand.fonts
  const name = (font: typeof heading) =>
    font.kind === 'bundled' ? BUNDLED_FONTS[font.id].label : font.family
  return [...new Set([display, heading, body].filter((f) => !!f).map((f) => name(f!)))]
}

/** The logo the portal's header shows: the design's own, else the workspace's. */
function logoOf(design: PortalDesign, workspaceLogo: string | null): string | null {
  const { mark, wordmark, display } = design.brand.logo
  const key =
    display === 'wordmark'
      ? (wordmark.light?.key ?? mark.light?.key)
      : (mark.light?.key ?? wordmark.light?.key)
  // designAssetUrl's address, written here: importing design-view would load the
  // portal's whole design view into admin settings.
  return key ? `/api/storage/${key}` : workspaceLogo
}

/**
 * The live portal, small: its home laid out at desktop width and scaled to
 * the box. A picture, not a page to use: it takes no focus or clicks.
 */
function PortalThumbnail() {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const scale = width > 0 ? width / DESKTOP_WIDTH : 0.25
  return (
    <div
      ref={box}
      inert
      aria-hidden="true"
      className="relative aspect-[16/10] w-full overflow-hidden rounded-md border border-border bg-muted"
    >
      <ClientOnly>
        <iframe
          src={portalPreviewSrc('light')}
          title="Your portal"
          loading="lazy"
          tabIndex={-1}
          className="pointer-events-none absolute start-0 top-0 origin-top-left border-0 bg-background"
          style={{
            width: DESKTOP_WIDTH,
            height: (DESKTOP_WIDTH * 10) / 16,
            transform: `scale(${scale})`,
          }}
        />
      </ClientOnly>
    </div>
  )
}

/**
 * Appearance: what visitors see now (a picture of the portal, its logo,
 * colours and fonts), what waits in the draft, and the way into the builder,
 * where the design is changed and published.
 */
export function AppearanceView() {
  const { data } = useSuspenseQuery(portalDesignQueries.editor())
  const versions = useQuery(portalDesignQueries.versions())
  const queryClient = useQueryClient()
  const [history, setHistory] = useState(false)
  const waiting = data.source === 'draft' ? designChanges(data.live, data.design).length : 0
  const latest = versions.data?.[0]
  const settings = useWorkspaceSettings()
  const name = data.live.brand.logo.name ?? settings?.name ?? ''
  const logo = logoOf(data.live, settings?.brandingData?.logoUrl ?? null)
  const fonts = brandFonts(data.live)

  const restore = async (revisionId: PortalDesignRevisionId) => {
    const outcome = await restorePortalDesignVersionFn({ data: { revisionId } })
    if (!outcome.ok) return { ok: false as const, message: outcome.message }
    await queryClient.invalidateQueries({ queryKey: portalDesignQueries.editor().queryKey })
    return { ok: true as const }
  }

  return (
    <SettingsCard
      title="Design"
      action={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setHistory(true)}>
            Versions
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={MATCH_HREF}>Match your brand</a>
          </Button>
          <Button size="sm" asChild>
            <a href={BUILDER_HREF}>Open builder</a>
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,18rem)_1fr]">
        <PortalThumbnail />
        <dl className="grid h-fit grid-cols-[6rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Logo</dt>
          <dd className="flex min-w-0 items-center gap-2">
            {logo && (
              <img
                src={logo}
                alt={`${name} logo`}
                className="size-6 shrink-0 rounded object-contain"
              />
            )}
            <span className="truncate">{name}</span>
          </dd>
          <dt className="text-muted-foreground">Colours</dt>
          <dd>
            <ul aria-label="Colours" className="flex flex-wrap gap-1.5">
              {brandSwatches(data.live).map((colour, index) => (
                <li
                  key={`${colour}-${index}`}
                  data-swatch=""
                  title={colour}
                  className="size-5 rounded-full border border-border"
                  style={{ backgroundColor: colour }}
                />
              ))}
            </ul>
          </dd>
          <dt className="text-muted-foreground">Fonts</dt>
          <dd className="truncate">{fonts.join(', ')}</dd>
        </dl>
      </div>
      <dl className="mt-5 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-3 border-t border-border pt-4 text-sm">
        <dt className="text-muted-foreground">Live</dt>
        <dd>
          {data.published ? (
            <span>
              Version {data.published.number}
              {latest?.number === data.published.number && (
                <>
                  , published <TimeAgo date={latest.createdAt} />
                </>
              )}
            </span>
          ) : (
            <span>Nothing published yet</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Draft</dt>
        <dd>
          {waiting === 0
            ? 'No changes waiting'
            : `${waiting} ${waiting === 1 ? 'change' : 'changes'} waiting to publish`}
        </dd>
      </dl>
      <HistoryDialog
        open={history}
        onOpenChange={setHistory}
        currentNumber={data.published?.number ?? null}
        onRestore={restore}
      />
    </SettingsCard>
  )
}
