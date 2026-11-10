/**
 * A brand matched from the website alone (no screenshot: the match the
 * builder runs when it opens from onboarding) writes its words through the
 * starting looks, not the words step. They read posts, never "ideas", as
 * every other match's do.
 */
import { describe, expect, it, vi } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import type { Look } from '../design-looks'
import { GATES } from './edit-eval/cases'

vi.mock('@/lib/server/config', () => ({ config: {} }))

const written = vi.hoisted(() => ({ looks: [] as Look[] }))
vi.mock('../design-ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../design-ai')>()),
  designAiModel: () => 'model',
  allowanceRefusal: async () => null,
}))
vi.mock('../look-calls', () => ({ writeLooks: async () => written.looks }))

const { DIRECTIONS_EXAMPLE } = await import('../design-directions')
const { matchBrand } = await import('../brand-start')
const { siteOnlyMatch } = await import('../brand-site-match')

const allows = {
  blockTypes: ['composer', 'ideas', 'roadmap', 'updates'] as Array<
    'composer' | 'ideas' | 'roadmap' | 'updates'
  >,
  checkCss: () => null,
  gates: GATES,
}

describe('a match from the website alone', () => {
  it('writes posts where the model wrote ideas', async () => {
    written.looks = [
      {
        ...DIRECTIONS_EXAMPLE,
        headline: 'Got an idea?',
        subtitle: 'Tell us what to build, and vote on the ideas you want most.',
        prompt: 'A feature, a fix or a idea?',
        submit: 'Send your idea',
        homeHeadline: 'Ideas welcome',
        homeSubtitle: 'Share an idea with the team.',
      },
    ]
    const design = defaultDesign()
    const result = await siteOnlyMatch(
      {
        design,
        allows,
        site: {
          facts: {
            url: 'https://acme.test/',
            colours: [],
            fonts: { heading: null, body: null, faces: [], hosted: [] },
          },
          favicon: null,
          logo: null,
          shareImage: null,
          failed: null,
        } as never,
      },
      {
        fallback: () =>
          matchBrand({
            design,
            images: [],
            name: 'Acme',
            hasMark: false,
            allows,
          }),
      },
      null
    )
    if (!result.ok) throw new Error('expected a match')
    const { feedback, home } = result.design.pages
    expect(feedback.headline?.title).toEqual({ en: 'Got a post?' })
    expect(feedback.headline?.subtitle).toEqual({
      en: 'Tell us what to build, and vote on the posts you want most.',
    })
    expect(feedback.copy?.prompt).toEqual({ en: 'A feature, a fix or a post?' })
    expect(feedback.copy?.submit).toEqual({ en: 'Send your post' })
    expect(home.headline?.title).toEqual({ en: 'Posts welcome' })
    expect(home.headline?.subtitle).toEqual({ en: 'Share a post with the team.' })
  })
})
