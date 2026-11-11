/**
 * Theme: the brand on every page and in the widget, on the properties frame.
 * Titled sections of compact rows in a fixed order: the brand kit (icon,
 * title, colours as variables), fonts, style (the look, corners, appearance,
 * page width, hover and the page background), the elements every page draws,
 * always in view, the site's images, and a closed Advanced with custom CSS.
 * The places set differently close it as the footer. No paragraphs in the
 * normal state.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/16/solid'
import { CssFields, type CssWarning } from '@/components/admin/settings/appearance/css-section'
import { designerAdvancedOpened } from '@/lib/client/builder-events'
import type { ThemeAt } from '@/lib/shared/design/builder-chrome'
import { hoverTileOf, writeHoverTile, type HoverTile } from '@/lib/shared/design/hover-lift'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { StyleOverride } from '@/lib/shared/design/style-overrides'
import type { StyleElement, StyleState } from '@/lib/shared/design/style-tokens'
import { BrandKit, BrandKitImages } from './brand-kit'
import { revealFontSlot } from './brand-kit-fonts'
import { ADVANCED_OPEN, FIND } from './find-rows'
import { ElementPanel } from './element-panel'
import { currentLookName, LookPicker, useSavedLooks } from './look-picker'
import { PageBackgroundEntry, PageBackgroundSection } from './page-background-settings'
import { OverridesList } from './overrides-list'
import { PropertyRow, PropertySection, PropertyTiles } from './properties/properties-panel'
import { CORNER_NAMES, THEME, WORDS } from './properties/words'
import { ThemeElements, elementName } from './styles-panel'
import { SummaryRow } from './properties/summary-row'

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
    <div className="text-ui" data-theme-view={title}>
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

/**
 * Theme's last section: custom CSS, closed until asked for. Its title is the
 * one disclosure at Theme's top level; each opening is counted, and the
 * editor draws only while open.
 */
function AdvancedSection({
  design,
  update,
  cssWarnings,
}: {
  design: PortalDesign
  update: Update
  cssWarnings: readonly CssWarning[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-labelledby="theme-advanced" className="border-b border-border px-4 py-2.5">
      <h3 id="theme-advanced" className="text-xs font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="theme-advanced-rows"
          data-find-open={ADVANCED_OPEN}
          onClick={() => {
            if (!open) designerAdvancedOpened('site:styles')
            setOpen(!open)
          }}
          className="flex min-h-6 w-full items-center gap-1 rounded text-start focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
        >
          {THEME.sections.advanced}
          <span className="flex-1" />
          <ChevronRightIcon
            className={`size-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
        </button>
      </h3>
      <div id="theme-advanced-rows" hidden={!open} className="mt-1 space-y-2">
        {open && (
          <>
            <div data-find={FIND.customCss.id} className="space-y-2">
              <p className="text-xs text-muted-foreground">{FIND.customCss.label}</p>
              <CssFields design={design} update={update} warnings={cssWarnings} />
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** What the sheet shows: Theme itself, or one of its sub-views in place. */
type View =
  | { kind: 'main' }
  | { kind: 'looks' }
  | { kind: 'background' }
  | { kind: 'element'; element: StyleElement }

const viewAt = (at: ThemeAt | undefined): View =>
  at?.element ? { kind: 'element', element: at.element } : { kind: 'main' }

export function ThemeContent({
  design,
  update,
  gates,
  logoUrl,
  cssWarnings,
  more = false,
  at,
  page = null,
  phone = false,
  onPhone,
  onLogo,
  onOverride,
  onBlock,
}: {
  /** Whether the canvas shows a phone: an element's panel then edits phone values. */
  phone?: boolean
  /** Shows the canvas as a phone, or on every screen. */
  onPhone?: (phone: boolean) => void
  /** Picks an override's element on the canvas. */
  onOverride?: (o: StyleOverride) => void
  /** Picks a Home block, whose own look a place set differently is. */
  onBlock?: (blockId: string) => void
  /** Picks the logo on the page, where its size and placement are set. */
  onLogo?: () => void
  design: PortalDesign
  /** Changes the draft, under a name for its undo where one is given. */
  update: Update
  gates: PortalPageGates
  logoUrl: string | null
  cssWarnings: readonly CssWarning[]
  /** Opened for a style set elsewhere, such as the page's width: Style is scrolled to. */
  more?: boolean
  /** The view quick find asks for: Theme itself, or an element's panel in a state. */
  at?: ThemeAt
  /** The page the canvas shows, whose own background "Just this page" sets. */
  page?: string | null
}) {
  const [view, setView] = useState<View>(() => viewAt(at))
  const [state, setState] = useState<StyleState>(at?.state ?? 'base')
  // Each time quick find asks for a view, it shows in the same render, even with the sheet open.
  const [seenAt, setSeenAt] = useState(at)
  if (at !== seenAt) {
    setSeenAt(at)
    if (at) {
      setView(viewAt(at))
      setState(at.state ?? 'base')
    }
  }
  const saved = useSavedLooks()
  const style = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (more) style.current?.querySelector('section')?.scrollIntoView?.({ block: 'start' })
  }, [more])
  const back = () => {
    setView({ kind: 'main' })
    setState('base')
  }
  if (view.kind === 'element')
    return (
      <div className="-m-4 flex min-h-full flex-col" data-theme-sheet="">
        <ElementPanel
          key={view.element}
          pick={{ element: view.element, part: null, section: null, index: 0 }}
          page="home"
          blockName={null}
          design={design}
          update={update}
          state={state}
          onState={setState}
          // It follows the canvas, as a pick on the canvas does.
          screen={phone ? 'phone' : 'all'}
          onScreen={onPhone ? (next) => onPhone(next === 'phone') : undefined}
          onUp={back}
          onFonts={(slot) => {
            back()
            void revealFontSlot(slot)
          }}
          shared
          crumbs={[{ label: WORDS.theme, onSelect: back }, { label: elementName(view.element) }]}
        />
      </div>
    )
  return (
    <div className="-m-4 flex min-h-full flex-col" data-theme-sheet="">
      {view.kind === 'looks' ? (
        <SubView title={THEME.looks} onBack={back}>
          <LookPicker design={design} update={update} logoUrl={logoUrl} />
        </SubView>
      ) : view.kind === 'background' ? (
        <SubView title={THEME.sections.pageBackground} onBack={back}>
          <PageBackgroundSection design={design} update={update} page={page} heading={false} />
        </SubView>
      ) : (
        <>
          <BrandKit design={design} update={update} logoUrl={logoUrl} onLogo={onLogo} />
          <div ref={style} className="contents">
            <PropertySection title={THEME.sections.style}>
              <SummaryRow
                label={FIND.look.label}
                find={FIND.look.id}
                value={currentLookName(design, saved) ?? THEME.custom}
                onOpen={() => setView({ kind: 'looks' })}
              />
              <PropertyRow label={FIND.corners.label} find={FIND.corners.id}>
                <PropertyTiles
                  label={FIND.corners.label}
                  value={design.shape.corners}
                  options={
                    Object.entries(CORNER_NAMES) as Array<
                      [PortalDesign['shape']['corners'], string]
                    >
                  }
                  onChange={(corners) => update((draft) => void (draft.shape.corners = corners))}
                />
              </PropertyRow>
              <PropertyRow
                label={FIND.appearance.label}
                find={FIND.appearance.id}
                source={THEME.autoHelp}
              >
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
              <PropertyRow label={FIND.pageWidth.label} find={FIND.pageWidth.id}>
                <PropertyTiles
                  label={THEME.pageWidth}
                  value={design.layout.width}
                  options={
                    Object.entries(THEME.widths) as Array<[PortalDesign['layout']['width'], string]>
                  }
                  onChange={(width) =>
                    update((draft) => void (draft.layout.width = width), THEME.pageWidth)
                  }
                />
              </PropertyRow>
              <PropertyRow label={FIND.hover.label} find={FIND.hover.id}>
                <PropertyTiles
                  label={THEME.hover}
                  value={hoverTileOf(design)}
                  options={Object.entries(THEME.hovers) as Array<[HoverTile, string]>}
                  onChange={(hover) => update((draft) => writeHoverTile(draft, hover), THEME.hover)}
                />
              </PropertyRow>
              <PageBackgroundEntry
                design={design}
                update={update}
                page={page}
                label={FIND.background.label}
                find={FIND.background.id}
                onOpen={() => setView({ kind: 'background' })}
              />
            </PropertySection>
          </div>
          <ThemeElements
            design={design}
            gates={gates}
            onOpen={(element) => setView({ kind: 'element', element })}
          />
          <BrandKitImages design={design} update={update} logoUrl={logoUrl} />
          <AdvancedSection design={design} update={update} cssWarnings={cssWarnings} />
          <footer className="mt-auto px-4 py-2.5 text-xs empty:hidden">
            <OverridesList design={design} update={update} onJump={onOverride} onBlock={onBlock} />
          </footer>
        </>
      )}
    </div>
  )
}
