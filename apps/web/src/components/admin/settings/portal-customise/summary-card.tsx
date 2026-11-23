import { ClientOnly, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { portalPreviewSrc } from '@/components/admin/settings/branding/portal-preview'
import type { SummaryRow } from './summary'

/** The thumbnail renders the home page at desktop width, scaled to fit. */
const THUMB = { width: 320, height: 200, page: 1280 }
const THUMB_SCALE = THUMB.width / THUMB.page

/**
 * Settings > Portal's one card: a picture of the live home page, what is
 * set, and the way into Customise.
 */
export function PortalSummaryCard({ summary }: { summary: SummaryRow[] }) {
  return (
    <SettingsCard
      title="Look and navigation"
      description="Logo, colours, type, tabs and the welcome message. Also applied to the embedded widget."
      action={
        <Button size="sm" asChild>
          <Link to="/admin/settings/portal/customise">Customise</Link>
        </Button>
      }
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div
          className="relative shrink-0 overflow-hidden rounded-lg border border-border bg-background"
          style={{ width: THUMB.width, height: THUMB.height }}
          aria-hidden="true"
        >
          {/* The published home page, never interactive; it waits for hydration. */}
          <ClientOnly>
            <iframe
              src={portalPreviewSrc('light', '/')}
              title="Portal thumbnail"
              tabIndex={-1}
              loading="lazy"
              className="pointer-events-none origin-top-left border-0"
              style={{
                width: THUMB.page,
                height: THUMB.height / THUMB_SCALE,
                transform: `scale(${THUMB_SCALE})`,
              }}
            />
          </ClientOnly>
        </div>
        <dl className="grid min-w-0 flex-1 grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {summary.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="flex min-w-0 items-center gap-2">
                {row.swatch ? (
                  <span
                    aria-hidden="true"
                    className="size-3.5 shrink-0 rounded-full border border-border/70"
                    style={{ backgroundColor: row.swatch }}
                  />
                ) : null}
                <span className="truncate">{row.value}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </SettingsCard>
  )
}
