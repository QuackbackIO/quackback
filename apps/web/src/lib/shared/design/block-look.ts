/**
 * A Home block's look (background, colour and alignment), shared by every
 * Home block unless one is set apart. A look has no site-wide value of its
 * own: the shared value is what the other blocks hold, and a shared change
 * writes every block that takes a look. The builder's look operations
 * (dispatch.ts) write through these.
 */
import type { HomeBlock } from './home'
import type { PortalDesign } from './schema'

/** A block's own look fields, other than its element looks. */
export type LookProp = 'tone' | 'align' | 'colour'
export const LOOK_PROPS: readonly LookProp[] = ['tone', 'align', 'colour']
type LookValue<P extends LookProp> = NonNullable<NonNullable<HomeBlock['look']>[P]>

/** What a block draws with while its look leaves a field out. */
export const LOOK_DEFAULTS: { [P in LookProp]: LookValue<P> } = {
  tone: 'card',
  align: 'start',
  colour: 'accent',
}

/** Where a look change goes: every Home block, or just this one. */
export type LookScope = 'every' | 'one'

/** Whether a block takes a look: the composer is a card of its own. */
export const takesLook = (block: HomeBlock) => block.type !== 'composer'

const lookBlocks = (design: PortalDesign) => design.pages.home.blocks.filter(takesLook)

function setField(block: HomeBlock, prop: LookProp, value: string | undefined) {
  const look = { ...block.look } as Record<string, unknown>
  if (value === undefined) delete look[prop]
  else look[prop] = value
  if (Object.keys(look).length) block.look = look as HomeBlock['look']
  else delete block.look
}

/** Writes a look field on this block, or on every Home block that takes a look; undefined clears it. */
export function writeLook(
  draft: PortalDesign,
  scope: LookScope,
  id: string,
  prop: LookProp,
  value: string | undefined
): void {
  const targets =
    scope === 'every' ? lookBlocks(draft) : draft.pages.home.blocks.filter((b) => b.id === id)
  for (const block of targets) setField(block, prop, value)
}

/**
 * The value most of the other Home blocks hold, which a block set apart goes
 * back to; undefined when most hold none, or there are no others.
 */
export function sharedLook(design: PortalDesign, id: string, prop: LookProp): string | undefined {
  const tally = new Map<string | undefined, number>()
  for (const block of lookBlocks(design)) {
    if (block.id === id) continue
    const value = block.look?.[prop]
    tally.set(value, (tally.get(value) ?? 0) + 1)
  }
  let best: string | undefined
  let most = 0
  for (const [value, n] of tally)
    if (n > most) {
      best = value
      most = n
    }
  return best
}

/**
 * Resets a look field: just this one goes back to the shared value, and
 * every Home block back to its usual one.
 */
export function resetLook(draft: PortalDesign, scope: LookScope, id: string, prop: LookProp) {
  writeLook(draft, scope, id, prop, scope === 'one' ? sharedLook(draft, id, prop) : undefined)
}

const drawn = (block: HomeBlock, prop: LookProp) => block.look?.[prop] ?? LOOK_DEFAULTS[prop]

/** The other Home blocks whose look differs from this one's, with the fields that differ. */
export function lookOutliers(
  design: PortalDesign,
  id: string
): Array<{ id: string; props: LookProp[] }> {
  const self = design.pages.home.blocks.find((b) => b.id === id)
  if (!self) return []
  return lookBlocks(design).flatMap((block) => {
    if (block.id === id || !block.id) return []
    const props = LOOK_PROPS.filter((prop) => drawn(block, prop) !== drawn(self, prop))
    return props.length ? [{ id: block.id, props }] : []
  })
}

/** Gives another block this block's look fields, keeping its element looks. */
export function matchLook(draft: PortalDesign, targetId: string, fromId: string): void {
  const from = draft.pages.home.blocks.find((b) => b.id === fromId)
  const target = draft.pages.home.blocks.find((b) => b.id === targetId)
  if (!from || !target) return
  for (const prop of LOOK_PROPS) setField(target, prop, from.look?.[prop])
}

/** Whether phones leave the block out (`look.phone.hidden`). */
export const hiddenOnPhones = (block: HomeBlock): boolean => block.look?.phone?.hidden === true

/** Leaves the block off phones, or shows it there again, which clears the field. */
export function setHiddenOnPhones(draft: PortalDesign, id: string, hidden: boolean): void {
  const block = draft.pages.home.blocks.find((each) => each.id === id)
  if (!block) return
  const phone: Record<string, unknown> = { ...block.look?.phone }
  if (hidden) phone.hidden = true
  else delete phone.hidden
  const look: Record<string, unknown> = { ...block.look }
  if (Object.keys(phone).length) look.phone = phone
  else delete look.phone
  if (Object.keys(look).length) block.look = look as HomeBlock['look']
  else delete block.look
}
