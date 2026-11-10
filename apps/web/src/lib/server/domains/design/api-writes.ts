/**
 * The rules an API or agent write to the draft goes through that a person's
 * builder save does not need: a merge patch replaces an array whole, so one
 * that touches Home's blocks, the overrides or the menu must say so; a
 * block written without its id would take one by position and pick up
 * another block's overrides; and Home's grid is settled, so a layout made
 * outside the builder never overlaps or leaves holes.
 */
import { settleHome } from '@/lib/shared/design/home'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { validateDesign } from './validate-design'

/** The arrays a merge patch replaces whole, which a patch must ask to replace. */
const REPLACED_ARRAYS = [['pages', 'home', 'blocks'], ['overrides'], ['nav', 'items']] as const

export type ApiWriteRefusal = { code: 'REPLACE_REQUIRED' | 'ID_REQUIRED'; message: string }

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** The value at `path` in a patch, and whether the patch names it at all. */
function at(patch: unknown, path: readonly string[]): { named: boolean; value?: unknown } {
  let here: unknown = patch
  for (const key of path) {
    if (!isObject(here) || !(key in here)) return { named: false }
    here = here[key]
  }
  return { named: true, value: here }
}

/**
 * Why a merge patch is refused before it is applied, or null: it names an
 * array without `replace`, or writes a Home block or menu link without an id.
 */
export function mergePatchRefusal(patch: unknown, replace: boolean): ApiWriteRefusal | null {
  if (!replace) {
    for (const path of REPLACED_ARRAYS) {
      if (!at(patch, path).named) continue
      const name = path.join('.')
      return {
        code: 'REPLACE_REQUIRED',
        message: `A merge patch replaces ${name} whole, dropping any item it leaves out. Send replace: true to replace it, or change one item with the draft operations.`,
      }
    }
  }
  return idRefusal(at(patch, ['pages', 'home', 'blocks']).value, at(patch, ['nav', 'items']).value)
}

/** Why blocks or menu items written without their ids are refused, or null. */
export function idRefusal(blocks: unknown, navItems?: unknown): ApiWriteRefusal | null {
  if (Array.isArray(blocks) && blocks.some((block) => !hasId(block)))
    return {
      code: 'ID_REQUIRED',
      message: 'Every Home block needs its id. Read the design for the ids blocks have now.',
    }
  if (
    Array.isArray(navItems) &&
    navItems.some((item) => isObject(item) && item.type === 'link' && !hasId(item))
  )
    return { code: 'ID_REQUIRED', message: 'Every menu link needs its id.' }
  return null
}

const hasId = (value: unknown) =>
  isObject(value) && typeof value.id === 'string' && value.id.trim().length > 0

/**
 * The design with Home's grid settled: each block at least its least size,
 * none overlapping, floated up. A design that does not validate is handed
 * back as it is, so the save refuses it with its own reason.
 */
export function settledForSave(input: unknown): unknown {
  let design: PortalDesign
  try {
    design = validateDesign(structuredClone(input))
  } catch {
    return input
  }
  settleHome(design)
  return design
}
