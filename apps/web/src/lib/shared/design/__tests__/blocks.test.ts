/**
 * The block registry: each block declares once what the builder needs, and
 * the panel, the Add sheet, the list and the AI read it. These tests hold the
 * registry to the design document, so a new block type, or a setting the
 * schema does not have, fails here first.
 */
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  BLOCK_JOBS,
  SECTION_TYPES,
  aiKeysOf,
  applySetting,
  blockOf,
  blocksByJob,
  sectionOf,
  summaryOf,
  writeSection,
  type SectionBlock,
} from '../blocks'
import { newBlock, type HomeBlock } from '../home'
import { BLOCK_SIZES, DESIGN_OPTIONS } from '../options'
import { BLOCK_NAMES } from '../outline'
import {
  changelogChoicesSchema,
  helpChoicesSchema,
  postChoicesSchema,
  roadmapChoicesSchema,
} from '../page-choices'
import { defaultDesign, homeBlockSchema } from '../schema'
import { shows, whenEmptyOf } from '../block-content'

const ROADMAP_ID = 'roadmap_01h455vb4pex5vsknk084sn02q'
const MOBILE = 'board_01h455vb4pex5vsknk084sn02q'
const SHARING = 'board_01h455vb4pex5vsknk084sn02r'

/** The schema keys a home block of this type can carry. */
function homeKeys(type: string): string[] {
  const option = homeBlockSchema.options.find(
    (candidate) => (candidate.shape.type as z.ZodLiteral<string>).value === type
  )
  return option ? Object.keys(option.shape) : []
}

const SECTION_SCHEMAS = {
  changelog: changelogChoicesSchema,
  help: helpChoicesSchema,
  roadmap: roadmapChoicesSchema,
  post: postChoicesSchema,
}

function block<T extends HomeBlock['type']>(
  type: T,
  extra: Partial<Extract<HomeBlock, { type: T }>> = {}
): Extract<HomeBlock, { type: T }> {
  return { ...newBlock(type), ...extra } as Extract<HomeBlock, { type: T }>
}

describe('the block registry', () => {
  it('has an entry for every Home block type the schema has', () => {
    const schemaTypes = homeBlockSchema.options.map(
      (option) => (option.shape.type as z.ZodLiteral<string>).value
    )
    expect(schemaTypes.sort()).toEqual([...DESIGN_OPTIONS.blockType].sort())
    for (const type of schemaTypes) expect(blockOf(type)?.type, type).toBe(type)
  })

  it('has an entry for every page section it lists', () => {
    for (const type of SECTION_TYPES) expect(blockOf(type)?.type).toBe(type)
  })

  it('knows nothing of a type it does not have', () => {
    expect(blockOf('carousel')).toBeNull()
  })

  it('names Home blocks as the outline does', () => {
    for (const type of DESIGN_OPTIONS.blockType) expect(blockOf(type)!.name).toBe(BLOCK_NAMES[type])
  })

  it('maps every setting to a field its type’s schema has', () => {
    for (const type of DESIGN_OPTIONS.blockType) {
      const keys = homeKeys(type)
      for (const field of blockOf(type)!.fields)
        expect(keys, `${type}.${field.key}`).toContain(field.key)
    }
    for (const type of SECTION_TYPES) {
      const def = blockOf(type)!
      const page = def.pages[0] as keyof typeof SECTION_SCHEMAS
      const keys = Object.keys(SECTION_SCHEMAS[page].shape)
      for (const field of def.fields) expect(keys, `${type}.${field.key}`).toContain(field.key)
    }
  })

  it('offers only choices the schema accepts', () => {
    for (const type of DESIGN_OPTIONS.blockType) {
      for (const field of blockOf(type)!.fields) {
        const values =
          field.kind === 'choice' || field.kind === 'count'
            ? field.options.map((option) => (Array.isArray(option) ? option[0] : option))
            : []
        for (const value of values)
          expect(
            applySetting(block(type), field.key, value).ok,
            `${type}.${field.key} = ${String(value)}`
          ).toBe(true)
      }
    }
  })

  it('gives each Home block its usual and least size on the grid, and no width setting', () => {
    for (const type of DESIGN_OPTIONS.blockType) {
      const def = blockOf(type)!
      const { size, min } = BLOCK_SIZES[type]
      expect(def.grid, type).toEqual({ w: size[0], h: size[1], minW: min[0], minH: min[1] })
      expect(def.grid!.w).toBeGreaterThanOrEqual(def.grid!.minW)
      expect(def.grid!.h).toBeGreaterThanOrEqual(def.grid!.minH)
      expect(def.fields.map((field) => field.key)).not.toContain('width')
    }
    expect(blockOf('ideas')!.grid).toMatchObject({ w: 6, h: 1, minW: 4, minH: 1 })
  })

  it('gives every block a name, a one-line purpose, a job and a page', () => {
    for (const type of [...DESIGN_OPTIONS.blockType, ...SECTION_TYPES]) {
      const def = blockOf(type)!
      expect(def.name.length).toBeGreaterThan(0)
      expect(def.purpose.length).toBeGreaterThan(0)
      expect(def.purpose).not.toMatch(/[\n—]/)
      expect(Object.keys(BLOCK_JOBS)).toContain(def.job)
      expect(def.pages.length).toBeGreaterThan(0)
    }
  })

  it('lets the AI change only settings the block has, never its place, which operations move', () => {
    for (const type of [...DESIGN_OPTIONS.blockType, ...SECTION_TYPES]) {
      const def = blockOf(type)!
      const keys = def.fields.map((field) => field.key)
      for (const key of aiKeysOf(type)) expect(keys, `${type} AI key ${key}`).toContain(key)
      expect(aiKeysOf(type), type).not.toContain('grid')
    }
  })

  it('offers the AI the workspace’s boards, roadmaps and topics by name, and links the person gave', () => {
    expect(aiKeysOf('ideas')).toEqual([
      'heading',
      'sort',
      'count',
      'boardIds',
      'showVotes',
      'showStatus',
      'showComments',
      'whenEmpty',
      'emptyText',
      'link',
    ])
    expect(aiKeysOf('roadmap')).toContain('statusIds')
    expect(aiKeysOf('roadmap')).toContain('roadmapId')
    expect(aiKeysOf('help_topics')).toContain('categoryIds')
    expect(aiKeysOf('links')).toContain('links')
    expect(aiKeysOf('carousel')).toEqual([])
  })

  it('describes every setting, and what each of a choice’s values looks like', () => {
    for (const type of [...DESIGN_OPTIONS.blockType, ...SECTION_TYPES, 'hero']) {
      for (const field of blockOf(type)!.fields) {
        expect(field.about.length, `${type}.${field.key}`).toBeGreaterThan(10)
        expect(field.about, `${type}.${field.key}`).not.toMatch(/[\n—]/)
        if (field.kind === 'choice') {
          expect(Object.keys(field.looks).sort(), `${type}.${field.key}`).toEqual(
            field.options.map(([value]) => value).sort()
          )
          for (const looks of Object.values(field.looks)) expect(looks.length).toBeGreaterThan(3)
        }
      }
    }
  })

  it('gives every block, section and the hero an example request with its operations', () => {
    for (const type of [...DESIGN_OPTIONS.blockType, ...SECTION_TYPES, 'hero']) {
      const { examples } = blockOf(type)!
      expect(examples.length, type).toBeGreaterThan(0)
      for (const example of examples) {
        expect(example.request.length).toBeGreaterThan(5)
        expect(example.ops.length).toBeGreaterThan(0)
      }
    }
  })

  it('says how many of each a page can hold', () => {
    expect(blockOf('composer')!.repeat).toBe('once')
    expect(blockOf('links')!.repeat).toBe('many')
    expect(blockOf('help.topics')!.repeat).toBe('once')
  })

  it('puts Home blocks on Home and page sections on their page', () => {
    expect(blockOf('ideas')!.pages).toEqual(['home'])
    expect(blockOf('changelog.entries')!.pages).toEqual(['changelog'])
    expect(blockOf('roadmap.board')!.pages).toEqual(['roadmap'])
  })
})

describe('the Add sheet’s groups', () => {
  it('groups every Home block under its job, in the jobs’ order', () => {
    const groups = blocksByJob()
    expect(groups.map((group) => group.name)).toEqual([
      'Help people find answers',
      'Hear from customers',
      'Show progress',
      'Your own',
    ])
    const listed = groups.flatMap((group) => group.blocks.map((def) => def.type))
    expect(listed.sort()).toEqual([...DESIGN_OPTIONS.blockType].sort())
    expect(groups[3]!.blocks.map((def) => def.type)).toEqual(['welcome', 'links'])
  })

  it('leaves out page sections, which are not added', () => {
    const listed = blocksByJob().flatMap((group) => group.blocks.map((def) => def.type))
    for (const type of SECTION_TYPES) expect(listed).not.toContain(type)
  })
})

describe('a block’s summary', () => {
  it('reads Top posts as its sort, count and boards', () => {
    expect(summaryOf(block('ideas', { sort: 'trending', count: 3 }))).toBe(
      'Trending · 3 posts · all boards'
    )
    expect(summaryOf(block('ideas', { sort: 'new', count: 5 }))).toBe(
      'Newest · 5 posts · all boards'
    )
  })

  it('names the boards Top posts draws from', () => {
    const picked = block('ideas', {
      sort: 'trending',
      count: 3,

      boardIds: [MOBILE, SHARING] as never,
    })
    const names = { boards: { [MOBILE]: 'Mobile', [SHARING]: 'Sharing' } }
    expect(summaryOf(picked, names)).toBe('Trending · 3 posts · Mobile, Sharing')
    expect(summaryOf(picked)).toBe('Trending · 3 posts · 2 boards')
    expect(summaryOf({ ...picked, boardIds: [] } as never, names)).toContain('all boards')
  })

  it('reads Latest updates as how many entries', () => {
    expect(summaryOf(block('updates', { count: 4 }))).toBe('4 latest entries')
  })

  it('names the roadmap a block shows, or the first public one', () => {
    expect(summaryOf(block('roadmap', {}))).toBe('First public roadmap')
    const picked = block('roadmap', { roadmapId: ROADMAP_ID as never })
    expect(summaryOf(picked, { roadmaps: { [ROADMAP_ID]: 'Mobile app' } })).toBe('Mobile app')
    expect(summaryOf(picked)).toBe('A chosen roadmap')
  })

  it('counts help topics and links', () => {
    expect(summaryOf(block('help_topics', {}))).toBe('First topics')
    expect(
      summaryOf(
        block('help_topics', {
          categoryIds: ['kb_category_01h455vb4pex5vsknk084sn02q'] as never,
        })
      )
    ).toBe('1 topic')
    expect(
      summaryOf(
        block('links', {
          links: [
            { label: 'Docs', url: 'https://example.com/docs' },
            { label: 'Blog', url: 'https://example.com/blog' },
          ],
        })
      )
    ).toBe('2 links')
  })

  it('quotes the start of Welcome’s words', () => {
    expect(summaryOf(block('welcome', {}))).toBe('“Welcome! Share feedback, see what is…”')
  })

  it('reads a block with no settings as nothing', () => {
    expect(summaryOf(block('composer'))).toBe('')
  })

  it('reads page sections as their choices', () => {
    const design = defaultDesign()
    expect(summaryOf(sectionOf(design, 'changelog.entries'))).toBe('Timeline · no images')
    expect(summaryOf(sectionOf(design, 'roadmap.board'))).toBe('Columns · votes shown')
    expect(summaryOf(sectionOf(design, 'help.popular'))).toBe('Shown')
    expect(summaryOf(sectionOf(design, 'help.search'))).toBe('Standard size')
    expect(summaryOf(sectionOf(design, 'help.topics'))).toBe('Cards')
  })
})

describe('changing a setting', () => {
  it('offers 10 posts, and boards to draw them from', () => {
    const before = block('ideas', { sort: 'trending', count: 3 })
    const ten = applySetting(before, 'count', 10)
    expect(ten.ok && ten.block).toMatchObject({ count: 10 })
    const boards = applySetting(before, 'boardIds', [MOBILE, SHARING])
    expect(boards.ok && boards.block).toMatchObject({ boardIds: [MOBILE, SHARING] })
    expect(applySetting(before, 'boardIds', ['not an id']).ok).toBe(false)
    expect(applySetting(before, 'boardIds', Array(11).fill(MOBILE)).ok).toBe(false)
    expect(applySetting(before, 'boardIds', []).ok).toBe(true)
  })

  it('returns the block with the setting changed, leaving the one given alone', () => {
    const before = block('ideas', { sort: 'trending', count: 3 })
    const result = applySetting(before, 'sort', 'top')
    expect(result).toEqual({ ok: true, block: { ...before, sort: 'top' } })
    expect(before.sort).toBe('trending')
  })

  it('refuses a value the schema does not take', () => {
    const before = block('ideas')
    const many = applySetting(before, 'count', 7)
    expect(many.ok).toBe(false)
    if (!many.ok) expect(many.refusal).toBe('How many can be 3, 5 or 10')
    expect(applySetting(before, 'sort', 'loudest').ok).toBe(false)
    expect(applySetting(before, 'width', 'full').ok).toBe(false)
    expect(applySetting(before, 'grid', { x: 0, y: 0, w: 12, h: 8 }).ok).toBe(false)
    expect(applySetting(block('roadmap'), 'roadmapId', 'not an id').ok).toBe(false)
  })

  it('refuses a setting the block does not have', () => {
    const result = applySetting(block('composer'), 'sort', 'top')
    expect(result).toEqual({ ok: false, refusal: 'Write a post has no setting called sort' })
    expect(applySetting(block('ideas'), 'id', 'abcdefgh').ok).toBe(false)
  })

  it('sets a heading in one language and clears it back to the usual one', () => {
    const named = applySetting(block('ideas'), 'heading', 'Loved ideas', 'en')
    expect(named.ok && named.block.heading).toEqual({ en: 'Loved ideas' })
    if (!named.ok) return
    const german = applySetting(named.block, 'heading', 'Beliebt', 'de')
    expect(german.ok && german.block.heading).toEqual({ en: 'Loved ideas', de: 'Beliebt' })
    const cleared = applySetting(named.block, 'heading', '', 'en')
    expect(cleared.ok && 'heading' in cleared.block).toBe(false)
    expect(applySetting(block('ideas'), 'heading', 'x'.repeat(61)).ok).toBe(false)
    expect(applySetting(block('ideas'), 'heading', 3).ok).toBe(false)
  })

  it('picks a roadmap, or the first public one', () => {
    const picked = applySetting(block('roadmap'), 'roadmapId', ROADMAP_ID)
    expect(picked.ok && (picked.block as { roadmapId: unknown }).roadmapId).toBe(ROADMAP_ID)
    const first = applySetting(block('roadmap'), 'roadmapId', null)
    expect(first.ok && (first.block as { roadmapId: unknown }).roadmapId).toBeNull()
  })

  it('picks up to eight help topics', () => {
    const ids = Array.from({ length: 9 }, (_, i) => `kb_category_01h455vb4pex5vsknk084sn0${i}q`)
    expect(applySetting(block('help_topics'), 'categoryIds', ids.slice(0, 8)).ok).toBe(true)
    expect(applySetting(block('help_topics'), 'categoryIds', ids).ok).toBe(false)
  })

  it('changes a page section’s choices and writes them back as the page reads them', () => {
    const design = defaultDesign()
    const entries = applySetting(sectionOf(design, 'changelog.entries'), 'entries', 'cards')
    expect(entries.ok).toBe(true)
    if (!entries.ok) return
    writeSection(design, entries.block as SectionBlock)
    expect(design.pages.changelog).toEqual({ entries: 'cards' })
    // Today's look again leaves the page as it was.
    const back = applySetting(entries.block, 'entries', 'timeline')
    if (back.ok) writeSection(design, back.block as SectionBlock)
    expect(design.pages.changelog).toBeUndefined()
    expect(applySetting(sectionOf(design, 'roadmap.board'), 'votes', 'yes').ok).toBe(false)
    const off = applySetting(sectionOf(design, 'roadmap.board'), 'votes', false)
    expect(off.ok).toBe(true)
  })
})

describe('the data blocks’ settings', () => {
  const DATA = ['ideas', 'roadmap', 'updates', 'help_topics', 'status'] as const

  it('draw by the same usual values the portal draws by, for a block that leaves them out', () => {
    for (const type of DESIGN_OPTIONS.blockType) {
      const fresh = newBlock(type)
      for (const field of blockOf(type)!.fields) {
        if (field.kind === 'switch' && field.default !== undefined)
          expect(shows(fresh, field.key as never), `${type}.${field.key}`).toBe(field.default)
        if (field.key === 'whenEmpty' && field.kind === 'choice')
          expect(whenEmptyOf(fresh as never), type).toBe(field.default)
      }
    }
  })

  it('give each data block a choice of what to do with nothing, and its message only then', () => {
    for (const type of DATA) {
      const fields = blockOf(type)!.fields
      const message = fields.find((field) => field.key === 'emptyText')!
      expect(
        fields.some((field) => field.key === 'whenEmpty'),
        type
      ).toBe(true)
      expect(message.when?.key, type).toBe('whenEmpty')
    }
  })

  it('write a block’s message by language, and give the usual back once emptied', () => {
    const block = newBlock('updates')
    const set = applySetting(block, 'emptyText', 'Soon', 'fr')
    expect(set.ok && set.block).toMatchObject({ emptyText: { fr: 'Soon' } })
    const cleared = set.ok ? applySetting(set.block, 'emptyText', '', 'fr') : null
    expect(cleared?.ok && cleared.block).not.toHaveProperty('emptyText')
  })

  it('refuse a count or a choice the block does not take', () => {
    expect(applySetting(newBlock('roadmap'), 'perColumn', 4).ok).toBe(false)
    expect(applySetting(newBlock('help_search'), 'popular', 0).ok).toBe(true)
    expect(applySetting(newBlock('help_topics'), 'layout', 'grid').ok).toBe(false)
  })
})
