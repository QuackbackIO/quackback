import { useMemo } from 'react'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/16/solid'
import type { Update } from '@/components/admin/settings/appearance/design-update'
import { addSheetGroups, type AddRow } from '@/lib/shared/design/add-sheet'
import { HOME_BLOCKS_MAX, type HomeBlockType } from '@/lib/shared/design/home'
import { homeSuggestions } from '@/lib/shared/design/overview'
import { offParts } from '@/lib/shared/design/menu'
import { PAGE_NAMES } from '@/lib/shared/design/names'
import type { PageGateSettings, PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { BlockIcon } from './block-icon'
import { HomeLayoutPicker } from './home-layout-picker'
import type { AddDrag } from './use-add-drag'
import { useNewParts } from './use-new-parts'
import { Tip } from './properties/properties-panel'
import { cn } from '@/lib/shared/utils'

/** The title over Home's layouts. */
export const ADD_LAYOUTS = 'Start Home from a layout'

/** The layouts' stable name, which quick find's action leads to. */
export const ADD_LAYOUTS_FIND = 'add-layouts'

/** Where a drag or a click puts the new block, in a line. */
export function addHint(after: string | null, onHome: boolean): string {
  if (!onHome) return 'Blocks go on Home. Adding one takes you there.'
  return after
    ? `Drag one onto the page, or click to add it under ${after}.`
    : 'Drag one onto the page, or click to add it at the end of Home.'
}

/** Each job's short name, as the sheet's group titles show it. */
export const JOB_TITLES = {
  answers: 'Answers',
  hear: 'Feedback',
  progress: 'Progress',
  own: 'Your own',
} as const

/** The one word a card's status says: on Home already, or where it goes. */
export function cardTag(row: { onHome: boolean }, onHome: boolean): string | null {
  if (row.onHome) return 'On Home'
  return onHome ? null : 'Goes on Home'
}

/** A card's picture: the block's icon in a small box. */
function CardIcon({ type, dim }: { type: HomeBlockType; dim?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-md bg-muted',
        dim && 'opacity-50'
      )}
    >
      <BlockIcon type={type} className="size-4" />
    </span>
  )
}

const CARD = 'flex min-h-16 w-full items-start gap-3 rounded-lg border border-border p-2 text-start'

/**
 * One block Add offers: its picture, name and what it is for, or why it is
 * suggested, with its status on the right. Clicked, it adds the block;
 * pressed and dragged past the threshold, it is dragged onto the page. One
 * whose page is off is greyed, and says under its purpose the page it needs,
 * with a link to where that page is turned on.
 */
export function AddCard({
  row,
  note,
  onHome,
  onAdd,
  drag,
  hint,
  turnOn,
}: {
  row: AddRow
  /** Where it goes, on hover. */
  hint?: string
  /** In place of the block's purpose, such as why it is suggested. */
  note?: string
  /** Whether Home is the page shown. */
  onHome: boolean
  onAdd: (type: HomeBlockType) => void
  drag?: Pick<AddDrag, 'press'>
  /** Where the page a gated block needs is turned on. */
  turnOn?: string
}) {
  if (row.needs)
    return (
      <div data-add-card="" className={CARD}>
        <CardIcon type={row.type} dim />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-ui font-medium text-muted-foreground">
            {row.def.name}
          </span>
          <span className="block text-xs text-muted-foreground">{row.def.purpose}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
            <span className="text-muted-foreground">Needs {PAGE_NAMES[row.needs]}</span>
            {turnOn && (
              <a
                href={turnOn}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-6 items-center gap-1 rounded font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
              >
                Turn on
                <span className="sr-only">
                  {' '}
                  {PAGE_NAMES[row.needs]} (goes live, opens in a new tab)
                </span>
                <ArrowTopRightOnSquareIcon className="size-3.5" aria-hidden="true" />
              </a>
            )}
          </span>
        </span>
      </div>
    )
  const tag = cardTag(row, onHome)
  return (
    <Tip text={row.disabled ? undefined : hint}>
      <button
        type="button"
        data-add-card=""
        disabled={row.disabled}
        onClick={() => onAdd(row.type)}
        onPointerDown={(event) => {
          if (!row.disabled) drag?.press(row.type, event)
        }}
        className={cn(
          CARD,
          'touch-none outline-none select-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-muted-foreground enabled:cursor-grab disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent'
        )}
      >
        <CardIcon type={row.type} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-ui font-medium">{row.def.name}</span>
          <span className="block text-xs text-muted-foreground">{note ?? row.def.purpose}</span>
        </span>
        {tag && (
          <span
            data-card-tag=""
            className="shrink-0 pt-px text-2xs whitespace-nowrap text-muted-foreground"
          >
            {tag}
          </span>
        )}
      </button>
    </Tip>
  )
}

/**
 * Add: the blocks Home can take, from the block registry, grouped by the job
 * each does, led by the ones suggested for the parts that are on. A block
 * already on Home says so. A click adds it under the picked block, or at the
 * end, and picks it; a drag puts it where it is dropped. Home's layouts follow.
 */
export function AddContent({
  design,
  update,
  gates,
  settings,
  after,
  onHome,
  onAdd,
  drag,
}: {
  design: PortalDesign
  update: Update
  gates: PortalPageGates
  /** What says where a page that is off is turned on. */
  settings?: PageGateSettings | null
  /** The picked block's name, which a new block goes under. */
  after: string | null
  /** Whether Home is the page shown. */
  onHome: boolean
  onAdd: (type: HomeBlockType) => void
  /** Dragging a card onto the page; without it, cards add by click only. */
  drag?: Pick<AddDrag, 'press'>
}) {
  const groups = useMemo(() => addSheetGroups(design, gates), [design, gates])
  const fresh = useNewParts(gates)
  const suggested = useMemo(() => {
    const rows = groups.flatMap((group) => group.rows)
    return homeSuggestions(design, gates, fresh).flatMap((each) => {
      const row = rows.find((one) => one.type === each.type)
      return row && !row.disabled ? [{ row, note: each.text }] : []
    })
  }, [design, gates, fresh, groups])
  const hint = addHint(after, onHome)
  const turnOn = useMemo(
    () => new Map(offParts(gates, settings ?? {}).map((part) => [part.type, part.href])),
    [gates, settings]
  )
  return (
    <div className="space-y-5">
      {suggested.length > 0 && (
        <section aria-labelledby="add-suggested" className="space-y-2">
          <h3 id="add-suggested" className="text-xs font-medium text-muted-foreground">
            Suggested
          </h3>
          <ul className="space-y-2">
            {suggested.map(({ row, note }) => (
              <li key={row.type}>
                <AddCard
                  row={row}
                  note={note}
                  hint={hint}
                  onHome={onHome}
                  onAdd={onAdd}
                  drag={drag}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {groups.map((group) => (
        <section key={group.job} aria-labelledby={`add-${group.job}`} className="space-y-2">
          <h3 id={`add-${group.job}`} className="text-xs font-medium text-muted-foreground">
            {JOB_TITLES[group.job]}
          </h3>
          <ul className="space-y-2">
            {group.rows.map((row) => (
              <li key={row.type}>
                <AddCard
                  row={row}
                  hint={hint}
                  onHome={onHome}
                  onAdd={onAdd}
                  drag={drag}
                  turnOn={row.needs ? turnOn.get(row.needs) : undefined}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {design.pages.home.blocks.length >= HOME_BLOCKS_MAX && (
        <p className="text-xs text-muted-foreground">Home holds {HOME_BLOCKS_MAX} blocks.</p>
      )}
      <section
        aria-labelledby="add-layouts"
        data-find={ADD_LAYOUTS_FIND}
        className="space-y-2 border-t border-border pt-4"
      >
        <h3 id="add-layouts" className="text-xs font-medium text-muted-foreground">
          {ADD_LAYOUTS}
        </h3>
        <HomeLayoutPicker design={design} update={update} gates={gates} />
      </section>
    </div>
  )
}
