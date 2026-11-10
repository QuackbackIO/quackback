/**
 * One module per Home block: the list of block types, their sizes, the pages
 * they need and their counts come from each block's own view module, which
 * visitors load, so a view module holds plain values and imports no more.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blockOf } from '../blocks'
import { HOME_BLOCK_TYPES, HOME_BLOCK_VIEWS } from '../blocks/view'
import { homeBlockTypes, newBlock } from '../home'
import { BLOCK_SIZES, DESIGN_OPTIONS } from '../options'
import { homeBlockSchema } from '../schema'

const FOLDER = join(__dirname, '..', 'blocks')

describe('the Home blocks’ modules', () => {
  it('give the design its block types, in the options’ order', () => {
    expect(DESIGN_OPTIONS.blockType).toEqual([
      'welcome',
      'composer',
      'ideas',
      'roadmap',
      'updates',
      'help_search',
      'help_topics',
      'status',
      'contact',
      'links',
      'boards',
    ])
    expect(HOME_BLOCK_TYPES).toEqual(DESIGN_OPTIONS.blockType)
    expect([...homeBlockSchema.options.map((option) => option.shape.type.value)].sort()).toEqual(
      [...HOME_BLOCK_TYPES].sort()
    )
  })

  it('give each block its sizes, and the registry its grid', () => {
    for (const view of HOME_BLOCK_VIEWS) {
      expect(BLOCK_SIZES[view.type]).toEqual({ size: view.size, min: view.min })
      expect(blockOf(view.type)?.grid).toEqual({
        w: view.size[0],
        h: view.size[1],
        minW: view.min[0],
        minH: view.min[1],
      })
      expect(newBlock(view.type)).toMatchObject({ type: view.type, ...view.made })
    }
  })

  it('leave out a block whose page is off', () => {
    const gates = {
      feedback: false,
      roadmap: true,
      changelog: true,
      help: false,
      support: true,
      status: true,
    }
    expect(homeBlockTypes(gates)).toEqual([
      'welcome',
      'links',
      'roadmap',
      'updates',
      'status',
      'contact',
    ])
  })

  it('offer each count once: the panel, the AI and the schema read the same list', () => {
    for (const view of HOME_BLOCK_VIEWS) {
      const counts = 'counts' in view ? (view.counts as Record<string, readonly number[]>) : {}
      for (const [key, offered] of Object.entries(counts)) {
        const field = blockOf(view.type)!.fields.find((each) => each.key === key)
        expect(field?.kind === 'count' && field.options, `${view.type}.${key}`).toBe(offered)
        const option = homeBlockSchema.options.find((each) => each.shape.type.value === view.type)!
        const shape = option.shape as Record<
          string,
          { safeParse: (v: unknown) => { success: boolean } }
        >
        for (const n of offered) expect(shape[key]!.safeParse(n).success).toBe(true)
        expect(shape[key]!.safeParse(Math.max(...offered) + 1).success).toBe(false)
      }
    }
  })

  it('keep a view module to plain values, so visitors load no schemas, rows or examples', () => {
    const views = readdirSync(FOLDER).filter(
      (name) => name.endsWith('.ts') && !/\.(def|schema)\.ts$/.test(name)
    )
    const builder = ['index.ts', 'fields.ts']
    const loose = views
      .filter((name) => !builder.includes(name))
      .flatMap((name) =>
        [
          ...readFileSync(join(FOLDER, name), 'utf8').matchAll(
            /^import (?!type ).*from '([^']+)'/gm
          ),
        ]
          .map((match) => match[1]!)
          .filter(
            (from) =>
              !/^\.\/[\w-]+$/.test(from) ||
              /\.(def|schema)$/.test(from) ||
              from === './index' ||
              from === './fields'
          )
          .map((from) => `${name}: ${from}`)
      )
    expect(loose).toEqual([])
  })
})
