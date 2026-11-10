import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import {
  duplicateHomeBlock,
  insertHomeBlock,
  moveHomeBlock,
  placeHomeBlock,
  settleHome,
  type HomeBlockType,
} from '@/lib/shared/design/home'
import { blockKey, BLOCK_NAMES, type Selection } from '@/lib/shared/design/outline'

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
}: {
  draft: Pick<ReturnType<typeof useDesignDraft>, 'design' | 'update'>
  selection: Selection | null
  setSelection: (selection: Selection | null) => void
  /** A block's name as the outline shows it. */
  nameOf: (key: Selection) => string | undefined
  say: (text: string) => void
}) {
  const blocks = draft.design.pages.home.blocks
  const indexOf = (key: Selection | null) =>
    blocks.findIndex((block, i) => blockKey(block, i) === key)
  const idOf = (key: Selection) => key.slice('block-'.length)

  const moveBlock = (key: Selection, by: -1 | 1) => {
    const at = indexOf(key)
    if (at < 0 || at + by < 0 || at + by >= blocks.length) return
    draft.update((next) => moveHomeBlock(next, idOf(key), by), 'Move block')
    say(movedSaid(nameOf(key) ?? 'Block', at + by, blocks.length))
  }
  /** Puts a block at a place counted before it moves, as a drop reads. */
  const placeBlock = (key: Selection, place: number) => {
    const at = indexOf(key)
    if (at < 0) return
    draft.update((next) => placeHomeBlock(next, idOf(key), place), 'Move block')
    say(movedSaid(nameOf(key) ?? 'Block', positionOf(at, place, blocks.length), blocks.length))
  }
  /** Adds a block under the picked block, else under them all; then picks it. */
  const addBlock = (type: HomeBlockType) => {
    const after = selection?.startsWith('block-') ? idOf(selection) : null
    const afterName = after && selection ? nameOf(selection) : undefined
    let added = null as Selection | null
    draft.update((next) => {
      added = blockKey(insertHomeBlock(next, type, after), 0)
    }, `Add ${BLOCK_NAMES[type]}`)
    if (added) setSelection(added)
    say(`${BLOCK_NAMES[type]} added ${afterName ? `under ${afterName}` : 'at the end of Home'}.`)
  }

  /**
   * Removes a block and picks the one after it, else the one before, so the
   * keyboard keeps its place; with none left, nothing is picked.
   */
  const removeBlock = (key: Selection) => {
    if (!key.startsWith('block-')) return
    const id = idOf(key)
    const name = nameOf(key) ?? 'Block'
    let neighbour: Selection | null = null
    draft.update((next) => {
      const list = next.pages.home.blocks
      const at = list.findIndex((block) => block.id === id)
      const kept = list.filter((block) => block.id !== id)
      const near = at < 0 ? undefined : (kept[at] ?? kept[at - 1])
      neighbour = near ? blockKey(near, kept.indexOf(near)) : null
      next.pages.home.blocks = kept
      // What was under it floats up.
      settleHome(next)
    }, 'Remove block')
    setSelection(neighbour)
    say(`${name} removed. Undo brings it back.`)
  }
  /** Copies a block in after it, and picks the copy. */
  const duplicateBlock = (key: Selection) => {
    if (!key.startsWith('block-')) return
    const name = nameOf(key) ?? 'Block'
    let copy: string | null = null
    draft.update((next) => {
      copy = duplicateHomeBlock(next, idOf(key))?.id ?? null
    }, 'Duplicate block')
    if (copy) {
      setSelection(`block-${copy}`)
      say(`${name} copied.`)
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
