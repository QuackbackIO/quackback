import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import { applyDesignOp, type DispatchResult } from '@/lib/shared/design/dispatch'
import type { HomeBlockType } from '@/lib/shared/design/home'
import { setLanding } from '@/lib/shared/design/menu'
import { blockKey, BLOCK_NAMES, type Selection } from '@/lib/shared/design/outline'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { dispatcher } from './dispatcher'
import { focusPicked } from './settings-focus'

/** What a screen reader hears after a block moves. */
export function movedSaid(name: string, position: number, count: number): string {
  return `${name} moved to place ${position + 1} of ${count}.`
}

/** Where a block ends after a place counted before it was taken out. */
const positionOf = (from: number, place: number, count: number) =>
  Math.min(place > from ? place - 1 : place, count - 1)

/**
 * Adding, moving, copying and removing Home's blocks, from the outline, the
 * right panel, Add and the keyboard, each said aloud.
 */
export function useBlockActions({
  draft,
  selection,
  setSelection,
  nameOf,
  say,
  gates,
}: {
  draft: Pick<ReturnType<typeof useDesignDraft>, 'design' | 'update'>
  selection: Selection | null
  setSelection: (selection: Selection | null) => void
  /** A block's name as the outline shows it. */
  nameOf: (key: Selection) => string | undefined
  say: (text: string) => void
  /** The pages that exist, for Home turned on by a block added while it is off. */
  gates: PortalPageGates
}) {
  const blocks = draft.design.pages.home.blocks
  const indexOf = (key: Selection | null) =>
    blocks.findIndex((block, i) => blockKey(block, i) === key)
  const idOf = (key: Selection) => key.slice('block-'.length)
  const dispatch = dispatcher(draft.design, draft.update)

  const moveBlock = (key: Selection, by: -1 | 1) => {
    const at = indexOf(key)
    if (at < 0 || at + by < 0 || at + by >= blocks.length) return
    dispatch({ op: 'block.step', id: idOf(key), by }, 'Move block')
    say(movedSaid(nameOf(key) ?? 'Block', at + by, blocks.length))
  }
  /** Puts a block at a place counted before it moves, as a drop reads. */
  const placeBlock = (key: Selection, place: number) => {
    const at = indexOf(key)
    if (at < 0) return
    dispatch({ op: 'block.place', id: idOf(key), place }, 'Move block')
    say(movedSaid(nameOf(key) ?? 'Block', positionOf(at, place, blocks.length), blocks.length))
  }
  /**
   * Adds a block under the picked block, else under them all; then picks it
   * and puts focus on its chip. While Home is off, the same step turns Home
   * on as Quick find's Turn on Home does, so the block is seen and one undo
   * takes back both.
   */
  const addBlock = (type: HomeBlockType) => {
    const homeOff = !draft.design.nav.home.on
    const after = !homeOff && selection?.startsWith('block-') ? idOf(selection) : null
    const afterName = after && selection ? nameOf(selection) : undefined
    const name = BLOCK_NAMES[type]
    let done: DispatchResult = { ok: false, refusal: '' }
    if (homeOff)
      draft.update((next) => {
        done = applyDesignOp(next, { op: 'block.add', type, after: null })
        // With the block in, Home is turned on as it is, never filled with starters.
        if (done.ok && done.block) setLanding(next, gates, 'home')
      }, `Add ${name} and turn on Home`)
    else done = dispatch({ op: 'block.add', type, after }, `Add ${name}`)
    if (!done.ok || !done.block) return
    setSelection(blockKey(done.block, 0))
    say(
      homeOff
        ? `Home turned on. ${name} added. Undo takes both back.`
        : `${name} added ${afterName ? `under ${afterName}` : 'at the end of Home'}.`
    )
    focusPicked(true)
  }

  /**
   * Removes a block and picks the one after it, else the one before, so the
   * keyboard keeps its place; with none left, nothing is picked.
   */
  const removeBlock = (key: Selection) => {
    if (!key.startsWith('block-')) return
    const id = idOf(key)
    const name = nameOf(key) ?? 'Block'
    // What was under it floats up, as removing a block settles Home.
    const done = dispatch({ op: 'block.remove', block: id }, 'Remove block')
    const near = done.ok ? done.near : null
    setSelection(near ? blockKey(near, 0) : null)
    say(`${name} removed. Undo brings it back.`)
    // The chip that had focus went with the block; it comes back on the next pick.
    focusPicked(!!near)
  }
  /** Copies a block in after it, and picks the copy. */
  const duplicateBlock = (key: Selection) => {
    if (!key.startsWith('block-')) return
    const name = nameOf(key) ?? 'Block'
    const done = dispatch({ op: 'block.duplicate', id: idOf(key) }, 'Duplicate block')
    const copy = done.ok ? done.block?.id : undefined
    if (copy) {
      setSelection(`block-${copy}`)
      say(`${name} copied.`)
      focusPicked(true)
    }
  }

  /** Delete removes the picked block and Ctrl+D copies it, outside fields; ? lists the keys. */
  const blockKeys = (event: ReactKeyboardEvent, onHelp: () => void) => {
    if (
      (event.target as Element).closest('input, textarea, select, [contenteditable], [role=dialog]')
    )
      return
    if (event.key === '?') return onHelp()
    if (!selection?.startsWith('block-')) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeBlock(selection)
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      duplicateBlock(selection)
    }
  }
  return { moveBlock, placeBlock, addBlock, removeBlock, duplicateBlock, blockKeys }
}
