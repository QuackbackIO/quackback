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
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { StyleOverride } from '@/lib/shared/design/style-overrides'
import type { StyleElement, StyleState } from '@/lib/shared/design/style-tokens'
import { BrandKit, BrandKitImages } from './brand-kit'
import { ElementPanel } from './element-panel'
import { currentLookName, LookPicker, useSavedLooks } from './look-picker'
import { PageBackgroundEntry, PageBackgroundSection } from './page-background-settings'
import { OverridesList } from './overrides-list'
import { PropertyRow, PropertySection, PropertyTiles } from './properties/properties-panel'
import { CORNER_NAMES, THEME, WORDS } from './properties/words'
import { ThemeElements, elementName } from './styles-panel'

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
            <p className="text-xs text-muted-foreground">{THEME.customCss}</p>
            <CssFields design={design} update={update} warnings={cssWarnings} />
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

export function ThemeContent({
  design,
  update,
  gates,
  logoUrl,
  cssWarnings,
  more = false,
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
  /** Opened for a style set elsewhere, such as the page's width: Style is scrolled to. */
  more?: boolean
  /** The page the canvas shows, whose own background "Just this page" sets. */
  page?: string | null
}) {
  const [view, setView] = useState<View>({ kind: 'main' })
  const [state, setState] = useState<StyleState>('base')
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
          screen="all"
          onUp={back}
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
          <BrandKit design={design} update={update} logoUrl={logoUrl} />
          <div ref={style} className="contents">
            <PropertySection title={THEME.sections.style}>
              <OpenRow
                label={THEME.look}
                value={currentLookName(design, saved) ?? THEME.custom}
                onOpen={() => setView({ kind: 'looks' })}
              />
              <PropertyRow label="Corners">
                <PropertyTiles
                  label="Corners"
                  value={design.shape.corners}
                  options={
                    Object.entries(CORNER_NAMES) as Array<
                      [PortalDesign['shape']['corners'], string]
                    >
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
              <PropertyRow label={THEME.pageWidth}>
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
              <PropertyRow label={THEME.hover}>
                <PropertyTiles
                  label={THEME.hover}
                  value={design.shape.hover ?? 'none'}
                  options={
                    Object.entries(THEME.hovers) as Array<
                      [NonNullable<PortalDesign['shape']['hover']> | 'none', string]
                    >
                  }
                  onChange={(hover) =>
                    update((draft) => {
                      if (hover === 'none') delete draft.shape.hover
                      else draft.shape.hover = hover
                    }, THEME.hover)
                  }
                />
              </PropertyRow>
              <PageBackgroundEntry
                design={design}
                update={update}
                page={page}
                label={THEME.background}
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
