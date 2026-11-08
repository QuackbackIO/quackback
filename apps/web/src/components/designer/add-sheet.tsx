import { useMemo } from 'react'
import type { Update } from '@/components/admin/settings/appearance/design-update'
import { addSheetGroups, type AddRow } from '@/lib/shared/design/add-sheet'
import { HOME_BLOCKS_MAX, type HomeBlockType } from '@/lib/shared/design/home'
import { homeSuggestions } from '@/lib/shared/design/overview'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { BlockIcon } from './block-icon'
import { HomeLayoutPicker } from './home-layout-picker'
import type { AddDrag } from './use-add-drag'
import { useNewParts } from './use-new-parts'

/** The title over Home's layouts, which quick find leads to. */
export const ADD_LAYOUTS = 'Start Home from a layout'

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

/** What a card says after its name: used, on Home already, or where it goes. */
function cardTag(row: { onHome: boolean; disabled: boolean }, onHome: boolean): string | null {
  if (row.onHome && row.disabled) return 'Already on Home'
  if (row.onHome) return 'on Home'
  return onHome ? null : 'Goes on Home'
}

/**
 * One block Add offers: its picture, name and what it is for, or why it is
 * suggested. Clicked, it adds the block; pressed and dragged past the
 * threshold, it is dragged onto the page.
 */
export function AddCard({
  row,
  note,
  onHome,
  onAdd,
  drag,
  hint,
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
}) {
  const tag = cardTag(row, onHome)
  return (
    <button
      type="button"
      title={row.disabled ? undefined : hint}
      disabled={row.disabled}
      onClick={() => onAdd(row.type)}
      onPointerDown={(event) => {
        if (!row.disabled) drag?.press(row.type, event)
      }}
      className="flex w-full touch-none select-none items-center gap-3 rounded-lg border border-border p-2 text-start outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-muted-foreground enabled:cursor-grab disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span
        aria-hidden="true"
        className="grid h-10 w-14 shrink-0 place-items-center rounded-md bg-muted"
      >
        <BlockIcon type={row.type} className="size-4" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[13px] font-medium">
          {row.def.name}
          {tag && <span className="font-normal text-muted-foreground"> · {tag}</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{note ?? row.def.purpose}</span>
      </span>
    </button>
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
  after,
  onHome,
  onAdd,
  drag,
}: {
  design: PortalDesign
  update: Update
  gates: PortalPageGates
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
                <AddCard row={row} hint={hint} onHome={onHome} onAdd={onAdd} drag={drag} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {design.pages.home.blocks.length >= HOME_BLOCKS_MAX && (
        <p className="text-xs text-muted-foreground">Home holds {HOME_BLOCKS_MAX} blocks.</p>
      )}
      <section aria-labelledby="add-layouts" className="space-y-2 border-t border-border pt-4">
        <h3 id="add-layouts" className="text-xs font-medium text-muted-foreground">
          {ADD_LAYOUTS}
        </h3>
        <HomeLayoutPicker design={design} update={update} gates={gates} />
      </section>
    </div>
  )
}
