/**
 * Every place a look is set differently, in Theme: page and part overrides
 * and Home blocks' own looks, grouped by the page, the part's place or the
 * block, each saying what it sets with its values (phones' and dark mode's
 * tagged), with a way to go to it on the canvas and a Reset. One whose part
 * is gone is flagged, with Remove: nothing draws it. It is the list an
 * element panel's footer shows of its own (set-differently.ts). Closed until
 * opened, and not there at all with none.
 */
import { ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import { resetPlace } from '@/lib/shared/design/override-cascade'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { clearOverride, type StyleOverride } from '@/lib/shared/design/style-overrides'
import { Advanced } from './advanced'
import { WORDS } from './properties/words'
import { setDifferently, type SetPlace } from './set-differently'

export function OverridesList({
  design,
  update,
  onJump,
  onBlock,
}: {
  design: PortalDesign
  update: (change: (draft: PortalDesign) => void, label?: string) => void
  /** Picks an override's element on the canvas. */
  onJump?: (o: StyleOverride) => void
  /** Picks a Home block, whose own look a place is. */
  onBlock?: (blockId: string) => void
}) {
  const list = setDifferently(design)
  if (!list.length) return null
  const groups = new Map<string, SetPlace[]>()
  for (const p of list) groups.set(p.group, [...(groups.get(p.group) ?? []), p])
  const go = (p: SetPlace) =>
    p.orphan
      ? undefined
      : p.override
        ? onJump && (() => onJump(p.override!))
        : p.place.block && onBlock
          ? () => onBlock(p.place.block!)
          : undefined
  return (
    <section aria-label={WORDS.setDifferently} data-overrides-list="">
      <Advanced title={WORDS.setDifferently} hint={String(list.length)}>
        {() => (
          <div className="space-y-4">
            {[...groups.entries()].map(([group, items]) => (
              <div key={group} className="space-y-1">
                <h4 className="text-xs font-medium text-muted-foreground">{group}</h4>
                <ul className="divide-y divide-border">
                  {items.map((p) => {
                    const onGo = go(p)
                    const action = p.orphan ? 'Remove' : WORDS.reset
                    return (
                      <li key={p.key} className="flex items-start gap-2 py-1.5 text-xs">
                        <div className="min-w-0 flex-1">
                          <span className="block">
                            {onGo ? (
                              <button
                                type="button"
                                onClick={onGo}
                                className="min-h-6 rounded py-1 text-start leading-4 font-medium hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                              >
                                {p.name}
                              </button>
                            ) : (
                              <span className="font-medium">{p.name}</span>
                            )}
                            {p.detail && (
                              <span className="text-muted-foreground">: {p.detail}</span>
                            )}
                          </span>
                          {p.orphan && (
                            <span className="mt-0.5 flex items-center gap-1">
                              <ExclamationTriangleIcon
                                className="size-3.5 text-warning"
                                aria-hidden="true"
                              />
                              Its part is gone, so nothing shows it
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label={`${action} ${p.name}`}
                          onClick={() =>
                            update(
                              (draft) =>
                                p.override
                                  ? clearOverride(draft, p.override.id)
                                  : resetPlace(draft, p.element, p.place),
                              `${p.name}: reset`
                            )
                          }
                          className="inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded px-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                        >
                          {action}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Advanced>
    </section>
  )
}
