/**
 * The Add sheet: the blocks Home can take, from the block registry, grouped
 * by the job each does. A block Home already has says so; one Home holds
 * once cannot be added again, and nothing can once Home is full. A click
 * puts the new block under the picked block, or at the end of Home.
 */
import { blocksByJob, type BlockDef, type BlockJob } from './blocks'
import { HOME_BLOCKS_MAX, homeBlockTypes, type HomeBlockType } from './home'
import type { PortalPageGates } from './paths'
import type { PortalDesign } from './schema'

export interface AddRow {
  type: HomeBlockType
  def: BlockDef
  /** Home already has one. */
  onHome: boolean
  /** It cannot be added: Home holds it once, or Home is full. */
  disabled: boolean
}

export interface AddGroup {
  job: BlockJob
  name: string
  rows: AddRow[]
}

export function addSheetGroups(design: PortalDesign, gates: PortalPageGates): AddGroup[] {
  const blocks = design.pages.home.blocks
  const offered = new Set(homeBlockTypes(gates))
  const used = new Set(blocks.map((block) => block.type))
  const full = blocks.length >= HOME_BLOCKS_MAX
  return blocksByJob()
    .map(({ job, name, blocks: defs }) => ({
      job,
      name,
      rows: defs
        .filter((def) => offered.has(def.type as HomeBlockType))
        .map((def) => {
          const type = def.type as HomeBlockType
          const onHome = used.has(type)
          return { type, def, onHome, disabled: full || (onHome && def.repeat === 'once') }
        }),
    }))
    .filter((group) => group.rows.length > 0)
}
