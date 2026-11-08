import { useId, useState } from 'react'
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import type { DesignerPage, OutlineNode, Selection } from '@/lib/shared/design/outline'
import {
  BACKGROUND_NAMES,
  backgroundOf,
  backgroundPageOf,
  siteBackground,
} from '@/lib/shared/design/page-background'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { PageBackgroundSection } from './page-background-settings'
import { PageTitleRows } from './page-section-settings'
import {
  PropertiesPanel,
  PropertyRow,
  PropertySection,
  PropertyTiles,
} from './properties/properties-panel'
import { THEME, WORDS } from './properties/words'
import type { Crumb } from './properties/properties-panel'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** The pages whose title can sit plain or in a hero, as Home's and Feedback's always do. */
const TITLED: readonly DesignerPage[] = ['roadmap', 'changelog', 'help', 'support']

const link =
  'rounded text-xs underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none'

/**
 * The page itself, shown with nothing picked: where its title sits, its
 * background and width, its parts as rows that pick each one, and the way
 * to Theme, which every page shares.
 */
export function PagePanel({
  crumbs,
  title,
  page,
  design,
  update,
  nodes,
  onSelect,
  onTheme,
}: {
  crumbs: readonly Crumb[]
  title: string
  page: DesignerPage
  design: PortalDesign
  update: NamedUpdate
  /** The page's outline: its parts, in the order a visitor meets them. */
  nodes: readonly OutlineNode[]
  onSelect: (selection: Selection) => void
  /** Opens Theme, at its Style for a style such as the page width. */
  onTheme: (more: boolean) => void
}) {
  const titles = design.layout.pageTitles
  const parts = nodes.filter((node) => node.key !== 'site')
  return (
    <PropertiesPanel
      crumbs={crumbs}
      title={title}
      kind={WORDS.page}
      data-page-panel=""
      className="pb-24"
    >
      <PropertySection title={WORDS.page}>
        {TITLED.includes(page) && (
          <PropertyRow
            label={WORDS.pageTitle}
            set={titles !== undefined}
            source={WORDS.titledPages}
            resetLabel={`${WORDS.reset} ${WORDS.pageTitle.toLowerCase()} to ${WORDS.titlePlain.toLowerCase()}`}
            onReset={() => update((draft) => void delete draft.layout.pageTitles, 'Page titles')}
          >
            <PropertyTiles
              label={WORDS.pageTitle}
              value={titles}
              inherited="plain"
              options={[
                ['plain', WORDS.titlePlain],
                ['band', WORDS.titleInHero],
              ]}
              onChange={(next) =>
                update((draft) => {
                  if (next === 'plain') delete draft.layout.pageTitles
                  else draft.layout.pageTitles = next
                }, 'Page titles')
              }
            />
          </PropertyRow>
        )}
        <PageTitleRows page={page} design={design} update={update} />
        <BackgroundRow design={design} update={update} page={page} />
        <PropertyRow label={WORDS.width} source={WORDS.fromBrand}>
          <button
            type="button"
            onClick={() => onTheme(true)}
            title={WORDS.setInTheme}
            className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-border px-1.5 text-[11px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
          >
            <span className="truncate">
              {WORDS.brand}: {THEME.widths[design.layout.width]}
            </span>
          </button>
        </PropertyRow>
      </PropertySection>
      {parts.length > 0 && (
        <PropertySection title={WORDS.onThisPage}>
          <ul aria-label={WORDS.onThisPage} className="-mx-1.5">
            {parts.map((node) => (
              <li key={node.key}>
                <button
                  type="button"
                  onClick={() => onSelect(node.key)}
                  className="flex min-h-7 w-full items-center rounded-md px-1.5 text-start text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                >
                  {node.label}
                </button>
              </li>
            ))}
          </ul>
        </PropertySection>
      )}
      <PropertySection title={WORDS.everyPage}>
        <p className="flex min-h-7 items-center gap-3">
          <button type="button" className={link} onClick={() => onTheme(false)}>
            {WORDS.theme}
          </button>
        </p>
      </PropertySection>
    </PropertiesPanel>
  )
}

/** What the page's background is and whose it is, opening to its settings in place. */
export function BackgroundRow({
  design,
  update,
  page,
}: {
  design: PortalDesign
  update: NamedUpdate
  page: DesignerPage
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const own = backgroundPageOf(page)
  const ownBg = own ? backgroundOf(design, own) : null
  const shown = ownBg ?? siteBackground(design)
  return (
    <>
      <PropertyRow label={WORDS.background} htmlFor={id}>
        <button
          id={id}
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-settings`}
          onClick={() => setOpen(!open)}
          className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-start text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
        >
          <span className="min-w-0 flex-1 truncate">
            {ownBg ? WORDS.thisPage : WORDS.everyPage}: {BACKGROUND_NAMES[shown.kind]}
          </span>
          <ChevronRightIcon
            className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
        </button>
      </PropertyRow>
      <div id={`${id}-settings`} hidden={!open} className="pt-1 pb-2">
        {open && (
          <PageBackgroundSection design={design} update={update} page={page} heading={false} />
        )}
      </div>
    </>
  )
}
