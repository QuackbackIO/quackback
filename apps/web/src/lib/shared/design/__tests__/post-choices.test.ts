/**
 * The post page's three fixed parts, Vote, Details and Comments: where its
 * one vote control sits, which details show and where Subscribe sits, and
 * the comments' order. Each is optional, so a design without them draws the
 * page as it was (with one vote control), carried to the portal as
 * attributes, named, and reachable by Quackback AI.
 */
import { postVotePlaces } from '@/components/public/preview-draft-context'
import { describe, expect, it } from 'vitest'
import { fieldGuide } from '@/lib/server/domains/design/ai/design-ai-guide'
import { applyDesignChanges, scopeFields } from '../apply-changes'
import { blockOf, sectionOf, writeSection } from '../blocks'
import { sectionTypeOf } from '../builder-chrome'
import { applyOp, type OpWorld } from '../design-ops'
import { changeGroup, changeLabel } from '../labels'
import { panelFor } from '../panel-routes'
import { canvasPickOf } from '../selection'
import { outlineKeys, outlineOf } from '../outline'
import { PAGE_CHOICE_DEFAULTS, pageChoiceAttributes, readPageChoices } from '../page-choices'
import { defaultDesign, portalDesign } from '../schema'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const world: OpWorld = { gates: GATES, places: { boards: [], roadmaps: [], categories: [] } }

describe('the post page’s choices', () => {
  it('draws one vote beside the title, every detail, Subscribe in the details and newest comments first by default', () => {
    expect(PAGE_CHOICE_DEFAULTS.post).toEqual({
      vote: 'title',
      board: true,
      tags: true,
      date: true,
      author: true,
      subscribe: 'details',
      comments: 'newest',
    })
    expect(readPageChoices(undefined).post).toEqual(PAGE_CHOICE_DEFAULTS.post)
    expect(pageChoiceAttributes(defaultDesign())).toEqual({})
  })

  it('keeps each choice, carries it as an attribute and reads it back', () => {
    const design = defaultDesign()
    design.pages.post = { vote: 'details', tags: false, subscribe: 'comments', comments: 'oldest' }
    expect(portalDesign.parse(design).pages.post).toEqual(design.pages.post)
    const attributes = pageChoiceAttributes(design)
    expect(attributes).toEqual({
      'data-qb-post-vote': 'details',
      'data-qb-post-tags': 'off',
      'data-qb-post-subscribe': 'comments',
      'data-qb-post-comments': 'oldest',
    })
    expect(readPageChoices(attributes).post).toMatchObject({
      vote: 'details',
      tags: false,
      board: true,
      subscribe: 'comments',
      comments: 'oldest',
    })
    const bad = defaultDesign() as unknown as { pages: Record<string, unknown> }
    bad.pages.post = { vote: 'footer' }
    expect(portalDesign.safeParse(bad).success).toBe(false)
  })

  it('names each one, and lets a request about the post page set them', () => {
    expect(changeLabel('pages.post.vote')).toBe('Post vote')
    expect(changeGroup('pages.post.comments')).toBe('Post page')
    const result = applyDesignChanges(
      defaultDesign(),
      [{ path: 'pages.post.comments', value: 'oldest' }],
      'post'
    )
    expect(result.outOfScope).toEqual([])
    expect(scopeFields('post')).toContain('pages.post')
    const guide = fieldGuide([], false)
    for (const key of Object.keys(PAGE_CHOICE_DEFAULTS.post))
      expect(guide).toContain(`pages.post.${key}`)
  })
})

describe('the post page’s parts', () => {
  it('lists Vote, Details and Comments, and no hero', () => {
    expect(outlineKeys(outlineOf(defaultDesign(), 'post')).filter((k) => k !== 'site')).toEqual([
      'header',
      'logo',
      'vote',
      'details',
      'comments',
    ])
  })

  it('opens each one as a section of the post page, with its settings', () => {
    expect(sectionTypeOf('vote')).toBe('post.vote')
    expect(sectionTypeOf('details')).toBe('post.details')
    expect(sectionTypeOf('comments')).toBe('post.comments')
    expect(blockOf('post.vote')!.fields.map((field) => field.key)).toEqual(['vote'])
    expect(blockOf('post.details')!.fields.map((field) => field.key)).toEqual([
      'board',
      'tags',
      'date',
      'author',
      'subscribe',
    ])
    expect(blockOf('post.comments')!.fields.map((field) => field.key)).toEqual(['comments'])
  })

  it('is picked by a click on the canvas, opening its own panel under the post', () => {
    const outline = outlineKeys(outlineOf(defaultDesign(), 'post'))
    for (const part of ['vote', 'details', 'comments']) {
      expect(canvasPickOf(part, outline)).toBe(part)
      expect(panelFor(part as never, false, 'post').panel).toBe('section')
    }
    expect(canvasPickOf('vote', outlineKeys(outlineOf(defaultDesign(), 'feedback')))).toBeNull()
  })

  it('writes a choice, and leaves one back at its usual value out', () => {
    const design = defaultDesign()
    writeSection(design, { ...sectionOf(design, 'post.details'), author: false })
    expect(design.pages.post).toEqual({ author: false })
    writeSection(design, { ...sectionOf(design, 'post.details'), author: true })
    expect(design.pages).not.toHaveProperty('post')
  })

  it('takes Quackback AI’s operation on the post page', () => {
    const result = applyOp(defaultDesign(), world, {
      op: 'set',
      target: 'post page',
      key: 'vote',
      value: 'details',
    })
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.design.pages.post).toEqual({ vote: 'details' })
  })
})

describe('one vote control on a post', () => {
  it('beside the title: one control there at every width, none in the details', () => {
    expect(postVotePlaces('title', false)).toEqual({ title: 'always', details: 'none' })
  })

  it('in the details: the control there, and beside the title only where the details are hidden', () => {
    expect(postVotePlaces('details', false)).toEqual({ title: 'narrow', details: 'button' })
  })

  it('keeps a count over the voters list for the team, never a second control', () => {
    expect(postVotePlaces('title', true)).toEqual({ title: 'always', details: 'count' })
    expect(postVotePlaces('details', true)).toEqual({ title: 'narrow', details: 'button' })
  })
})
