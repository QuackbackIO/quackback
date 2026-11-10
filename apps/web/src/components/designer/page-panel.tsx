import { useId, useMemo, useState } from 'react'
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import type { DesignerPage, OutlineNode, Selection } from '@/lib/shared/design/outline'
import {
  BACKGROUND_NAMES,
  backgroundOf,
  backgroundPageOf,
  siteBackground,
} from '@/lib/shared/design/page-background'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import type { MenuPartId } from '@/lib/shared/design/menu'
import { pageTree, treeRows, type TreeRow } from '@/lib/shared/design/page-tree'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { dispatcher } from './dispatcher'
import { PageTree } from './page-tree'
import { useBlockActions } from './use-block-actions'
import { cn } from '@/lib/shared/utils'
import { PageBackgroundSection } from './page-background-settings'
import { PageTitleRows } from './page-section-settings'
import {
  PropertiesPanel,
  PropertyRow,
  PropertySection,
  PropertyTiles,
} from './properties/properties-panel'
import { FIND, TITLED } from './find-rows'
import { THEME, WORDS } from './properties/words'
import type { Crumb } from './properties/properties-panel'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** Every page's gates open, for a panel shown without them. */
const ALL_PAGES: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

/**
 * The page itself, shown with nothing picked: where its title sits, its
 * background and width, its parts as a tree that picks, hides and moves
 * them, and the way to Theme, which every page shares.
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
  gates = ALL_PAGES,
  act,
  onPick,
  say,
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
  /** The pages that are on, for the menu's items. */
  gates?: PortalPageGates
  /** A menu item's actions, as the header's panel takes them. */
  act?: (target: MenuPartId, action: 'show' | 'hide' | 'up' | 'down', from: 'panel') => void
  /** A row of the tree picked, as a click on the canvas picks it; else onSelect picks its part. */
  onPick?: (row: TreeRow) => void
  /** Says what changed, on the builder's status line. */
  say?: (words: string) => void
}) {
  const titles = design.layout.pageTitles
  const tree = useMemo(() => pageTree(design, gates, page, nodes), [design, gates, page, nodes])
  const dispatch = dispatcher(design, update)
  const blocks = useBlockActions({
    draft: { design, update } as unknown as Pick<
      ReturnType<typeof useDesignDraft>,
      'design' | 'update'
    >,
    selection: null,
    setSelection: () => {},
    nameOf: (key) => treeRows(tree).find((row) => row.key === key)?.label,
    say: (words) => say?.(words),
  })
  return (
    <PropertiesPanel crumbs={crumbs} title={title} data-page-panel="" className="pb-24">
      <PropertySection title={WORDS.page}>
        {TITLED.includes(page) && (
          <PropertyRow
            label={FIND.pageTitle.label}
            find={FIND.pageTitle.id}
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
      {tree.length > 0 && (
        <PropertySection title={WORDS.onThisPage}>
          <PageTree
            label={WORDS.onThisPage}
            rows={tree}
            onPick={(row) => (onPick ? onPick(row) : onSelect(row.key))}
            onShown={(row, shown) => {
              if (row.menu) return act?.(row.menu, shown ? 'show' : 'hide', 'panel')
              const name = `${shown ? WORDS.show : WORDS.hide} ${row.label}`
              dispatch({ op: 'part.shown', key: row.key, shown }, name)
              say?.(`${name}. Undo takes it back.`)
            }}
            onMove={(row, by) => {
              if (row.menu) return act?.(row.menu, by < 0 ? 'up' : 'down', 'panel')
              if (row.key.startsWith('block-')) blocks.moveBlock(row.key, by)
            }}
          />
        </PropertySection>
      )}
      <PropertySection title={WORDS.everyPage}>
        <button
          type="button"
          onClick={() => onTheme(false)}
          className="flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-start text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
        >
          <span className="min-w-0 flex-1 truncate">{WORDS.theme}</span>
          <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
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
      <PropertyRow label={FIND.pageBackground.label} find={FIND.pageBackground.id} htmlFor={id}>
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
