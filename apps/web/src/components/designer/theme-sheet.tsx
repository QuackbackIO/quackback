/**
 * Theme: the brand on every page and in the widget, on the properties frame.
 * Titled sections of compact rows, in order: the brand kit (icon, title,
 * colours as variables), fonts, style (the look, corners and appearance),
 * the page background as a row into its editor, the site's images, and a
 * closed More with the looks of each part, exact sizes and CSS. The places
 * set differently close it as the footer. No paragraphs in the normal state.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/16/solid'
import type { CssWarning } from '@/components/admin/settings/appearance/css-section'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { StyleOverride } from '@/lib/shared/design/style-overrides'
import { BrandKit, BrandKitImages } from './brand-kit'
import { currentLookName, LookPicker, useSavedLooks } from './look-picker'
import { PageBackgroundEntry, PageBackgroundSection } from './page-background-settings'
import { OverridesList } from './overrides-list'
import { PropertyRow, PropertySection, PropertyTiles } from './properties/properties-panel'
import { CORNER_NAMES, THEME, WORDS } from './properties/words'
import { StylesPanel } from './styles-panel'

/** The id of the More region, which the sheet's foot opens. */
export const THEME_MORE_ID = 'theme-more'

type Update = (change: (draft: PortalDesign) => void, label?: string) => void

/** A sub-view of the sheet, such as Looks: a way back to Theme and its title. */
function SubView({
  title,
  onBack,
  children,
}: {
  title: string
  onBack: () => void
  children: ReactNode
}) {
  return (
    <div className="text-[13px]" data-theme-view={title}>
      <nav aria-label="Where it is" className="border-b border-border px-4 py-2 text-xs">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
        >
          <ChevronLeftIcon className="size-3.5" aria-hidden="true" />
          {WORDS.theme}
        </button>
      </nav>
      <PropertySection title={title}>{children}</PropertySection>
    </div>
  )
}

/** A row that opens a sub-view: its value, and a chevron. */
function OpenRow({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
  return (
    <PropertyRow label={label}>
      <button
        type="button"
        aria-label={`${label}: ${value}`}
        onClick={onOpen}
        className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-start text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
    </PropertyRow>
  )
}

export function ThemeContent({
  design,
  update,
  gates,
  logoUrl,
  cssWarnings,
  more,
  onMore,
  page = null,
  onOverride,
  onBlock,
}: {
  /** Picks an override's element on the canvas. */
  onOverride?: (o: StyleOverride) => void
  /** Picks a Home block, whose own look a place set differently is. */
  onBlock?: (blockId: string) => void
  design: PortalDesign
  /** Changes the draft, under a name for its undo where one is given. */
  update: Update
  gates: PortalPageGates
  logoUrl: string | null
  cssWarnings: readonly CssWarning[]
  more: boolean
  onMore: (open: boolean) => void
  /** The page the canvas shows, whose own background "Just this page" sets. */
  page?: string | null
}) {
  const [view, setView] = useState<'main' | 'looks' | 'background'>('main')
  const saved = useSavedLooks()
  const region = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (more) region.current?.scrollIntoView?.({ block: 'start' })
  }, [more])
  const back = () => setView('main')
  return (
    <div className="-m-4 flex min-h-full flex-col" data-theme-sheet="">
      {view === 'looks' ? (
        <SubView title={THEME.looks} onBack={back}>
          <LookPicker design={design} update={update} />
        </SubView>
      ) : view === 'background' ? (
        <SubView title={THEME.sections.pageBackground} onBack={back}>
          <PageBackgroundSection design={design} update={update} page={page} heading={false} />
        </SubView>
      ) : (
        <>
          <BrandKit design={design} update={update} logoUrl={logoUrl} />
          <PropertySection title={THEME.sections.style}>
            <OpenRow
              label={THEME.look}
              value={currentLookName(design, saved) ?? THEME.custom}
              onOpen={() => setView('looks')}
            />
            <PropertyRow label="Corners">
              <PropertyTiles
                label="Corners"
                value={design.shape.corners}
                options={
                  Object.entries(CORNER_NAMES) as Array<[PortalDesign['shape']['corners'], string]>
                }
                onChange={(corners) => update((draft) => void (draft.shape.corners = corners))}
              />
            </PropertyRow>
            <PropertyRow label={THEME.appearance} source={THEME.autoHelp}>
              <PropertyTiles
                label={THEME.appearance}
                value={design.mode}
                options={[
                  ['light', THEME.appearances.light],
                  ['dark', THEME.appearances.dark],
                  ['auto', THEME.appearances.auto],
                ]}
                onChange={(mode) => update((draft) => void (draft.mode = mode))}
              />
            </PropertyRow>
          </PropertySection>
          <PropertySection title={THEME.sections.pageBackground}>
            <PageBackgroundEntry
              design={design}
              update={update}
              page={page}
              onOpen={() => setView('background')}
            />
          </PropertySection>
          <BrandKitImages design={design} update={update} logoUrl={logoUrl} />
          <details
            id={THEME_MORE_ID}
            ref={region}
            open={more}
            onToggle={(event) => {
              if (event.currentTarget.open !== more) onMore(event.currentTarget.open)
            }}
            className="group border-b border-border px-4 py-2.5"
          >
            <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1 rounded text-xs font-semibold focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon
                className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
              {WORDS.more}
            </summary>
            {more && (
              <div className="-mx-4 pt-3">
                <StylesPanel
                  design={design}
                  update={update}
                  gates={gates}
                  logoUrl={logoUrl}
                  cssWarnings={cssWarnings}
                />
              </div>
            )}
          </details>
          <footer className="mt-auto px-4 py-2.5 text-xs empty:hidden">
            <OverridesList design={design} update={update} onJump={onOverride} onBlock={onBlock} />
          </footer>
        </>
      )}
    </div>
  )
}
