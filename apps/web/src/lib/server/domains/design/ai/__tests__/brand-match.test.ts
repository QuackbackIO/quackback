/**
 * The brand match's workflow on a synthetic screenshot with known answers
 * (a blue logo and button, a headline set in Inter Bold), the model calls
 * mocked: the stages run in order and report their steps, the finder runs
 * on every screenshot at once, the hero is decided before the words, a
 * failed or late stage falls back and says so, thin evidence is asked about,
 * and the reply offers follow-ups.
 */
import { describe, expect, it, vi } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { homeBlockTypes } from '@/lib/shared/design/home'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { deltaE00, parseColor, type RGB } from '../../extract/color'
import type { FoundElements } from '../../extract/finder'
import type { FinderOutput } from '../../extract/finder-schema'
import { BOX_KINDS, type Box, type BoxKind } from '../../extract/kinds'
import { encodePng, type Image } from '../../extract/png'
import { faceById } from '../../extract/fonts/faces'
import { fontFor, renderText } from '../../extract/fonts/woff'
import {
  brandMatch,
  type BrandMatchDeps,
  type BrandStep,
  type BrandMatchResult,
} from '../brand-match'
import type { FamilyRequest } from '../brand-brief'
import type { HeroAnswer } from '../hero-family'
import type { VoiceAnswer, WordsAnswer } from '../words-family'
import type { WordsPick } from '../words-pick'
import { colourName, followUps } from '../brand-reply'
import { matchType, type TypeMatches } from '../brand-fonts'
import { BUDGET } from '../brand-match'

// Each match measures full-size screenshots in plain JS (about 2s of CPU a run
// here, several times that on a shared CI runner), so the default 20s cap
// fails on load rather than on behaviour.
vi.setConfig({ testTimeout: 60_000 })

type Fill = [number, number, number]
const W = 1200
const H = 800
const WHITE: Fill = [255, 255, 255]
const INK: Fill = [17, 17, 17]
const GREY: Fill = [110, 110, 110]
const BLUE: Fill = [0, 88, 163]

function canvas(ground: Fill = WHITE): Image {
  const data = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) data.set([...ground, 255], i * 4)
  return { width: W, height: H, data }
}
function rect(img: Image, [x0, y0, x1, y1]: Box, c: Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([...c, 255], (y * img.width + x) * 4)
}
/** Words drawn in a bundled face at (x, y top), ink over white; gives the ink box. */
function words(
  img: Image,
  id: string,
  weight: number,
  size: number,
  text: string,
  x: number,
  y: number,
  ink: Fill
): Box {
  const drawn = renderText(fontFor(faceById(id)!, weight)!, size, text)
  let box: Box = [W, H, 0, 0]
  for (let j = 0; j < drawn.mask.h; j++)
    for (let i = 0; i < drawn.mask.w; i++) {
      const a = drawn.mask.a[j * drawn.mask.w + i]!
      if (!a) continue
      const o = ((y + j) * W + x + i) * 4
      for (let k = 0; k < 3; k++)
        img.data[o + k] = Math.round(img.data[o + k]! * (1 - a) + ink[k]! * a)
      if (a > 0.3)
        box = [
          Math.min(box[0], x + i),
          Math.min(box[1], y + j),
          Math.max(box[2], x + i + 1),
          Math.max(box[3], y + j + 1),
        ]
    }
  return [box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 3]
}

const HEADLINE = 'Plan and ship your best work'
const SUBTITLE = 'The tool for teams who build software together'

/** A page: a blue logo, a grey menu, a headline in Inter Bold, and (unless thin) a blue button. */
function page(thin = false, secondLine: Fill | null = null, ground: Fill = WHITE) {
  const img = canvas(ground)
  const boxes: Partial<Record<BoxKind, Box | null>> = {
    header: [0, 0, W, 80],
    logo: [40, 24, 140, 56],
    nav_row: [200, 34, 520, 46],
    hero: [0, 80, W, 600],
  }
  rect(img, boxes.logo!, BLUE)
  for (let x = 200; x < 520; x += 60) rect(img, [x, 34, x + 40, 46], GREY)
  boxes.headline = words(img, 'inter', 700, 48, HEADLINE, 80, 200, INK)
  if (secondLine) {
    // A two-tone headline: a second line in a lighter ink, under the first.
    const second = words(img, 'inter', 700, 48, 'for every team', 80, 254, secondLine)
    boxes.headline = [
      boxes.headline[0],
      boxes.headline[1],
      Math.max(boxes.headline[2], second[2]),
      second[3],
    ]
  }
  boxes.subtitle = words(img, 'inter', 400, 20, SUBTITLE, 80, 320, GREY)
  if (!thin) {
    boxes.primary_button = [80, 360, 240, 404]
    rect(img, boxes.primary_button, BLUE)
    rect(img, [110, 376, 210, 388], WHITE)
  }
  return { img, boxes }
}

const dataUrl = (img: Image) =>
  `data:image/png;base64,${Buffer.from(encodePng(img)).toString('base64')}`

function found(
  boxes: Partial<Record<BoxKind, Box | null>>,
  thin = false,
  behind: FinderOutput['behind_headline'] = 'illustration'
): FoundElements {
  const all = Object.fromEntries(BOX_KINDS.map((k) => [k, boxes[k] ?? null])) as Record<
    BoxKind,
    Box | null
  >
  const output: FinderOutput = {
    headline_text: HEADLINE,
    subtitle_text: SUBTITLE,
    logo_text: 'Acme',
    primary_button_text: thin ? '' : 'Get started',
    section_heading_text: '',
    ...(Object.fromEntries(
      BOX_KINDS.map((k) => [k, boxes[k] ? boxes[k]!.join(' ') : 'none'])
    ) as Record<BoxKind, string>),
    // An illustration leaves the hero open to the model; a plain page is settled by rule.
    behind_headline_evidence: behind === 'plain' ? 'white page' : 'a drawn scene beside the words',
    behind_headline: behind,
    nav_style: 'plain',
    text_case: 'normal',
    logo_kind: 'wordmark',
    headline_type: 'sans',
    body_type: 'sans',
    cookie_banner: false,
    dimmed: false,
    main_cta_visible: !thin,
    product_screenshot_visible: false,
  }
  return { version: 'test', output, scale: 1, boxes: all, snapped: all }
}

const HERO: HeroAnswer = {
  evidence: 'A plain white page behind the words.',
  look: 'plain_page',
  shape: 'edge_to_edge',
  art: 'none',
  header_on_hero: 'separate',
  picture: 'none',
  confidence: 'high',
}
const WORDS: WordsAnswer = {
  evidence: 'Plain and direct.',
  home_layout: 'portal',
  home_headline: 'Shape what Acme builds next',
  home_subtitle: 'Ask for features, follow the roadmap and find answers.',
  feedback_headline: 'Help us build Acme',
  feedback_subtitle: 'Tell us what would help, and vote for what matters.',
  prompt: 'A widget you would use',
  submit: 'Send it our way',
}
const VOICE: VoiceAnswer = {
  evidence: 'Plain and direct.',
  name: 'Acme',
  known: 'not',
  signatures: [],
  home_language: 'none',
  formality: 'neutral',
  humour: 'none',
  exclamations: 'never',
  emoji: 'never',
  vocabulary: ['plan', 'ship'],
  avoid: [],
}
const PICK: WordsPick = { reviews: [], choice: 'a', swaps: [], why: '' }
/** Each family's answer: the hero, the voice read, the critic's pick, else the words. */
const answerOf = (family: string) =>
  family === 'hero' ? HERO : family === 'voice' ? VOICE : family === 'words_pick' ? PICK : WORDS

const GATES: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  status: false,
  support: true,
} as PortalPageGates
const ALLOWS = {
  blockTypes: homeBlockTypes(GATES),
  gates: GATES,
  checkCss: () => 'no CSS',
}

/**
 * The type match for each kind of page, worked out once: it is the same CPU
 * work on the same pixels in every test (brand-fonts.test.ts covers the
 * worker that runs it in production).
 */
const typeMatches = new Map<string, TypeMatches>()

function setup(
  over: Partial<BrandMatchDeps> = {},
  thin = false,
  images = 1,
  secondLine: Fill | null = null,
  ground: Fill = WHITE
) {
  const shots = Array.from({ length: images }, () => page(thin, secondLine, ground))
  const order: string[] = []
  const deps: BrandMatchDeps = {
    find: vi.fn(async (img: Image) => {
      order.push('find')
      const at = shots.findIndex((s) => s.img.width === img.width)
      return found(shots[Math.max(0, at)]!.boxes, thin)
    }),
    roles: vi.fn(async () => {
      order.push('roles')
      return {
        evidence: '',
        identity: 'c1',
        action: 'brand_colour',
        highlight: 'none',
        confidence: 'high',
      }
    }),
    family: vi.fn(async <T>(request: FamilyRequest<T>) => {
      order.push(request.family)
      return answerOf(request.family) as T
    }) as unknown as BrandMatchDeps['family'],
    matchType: async (shot) => {
      const key = JSON.stringify([thin, secondLine, ground])
      if (!typeMatches.has(key)) typeMatches.set(key, matchType(shot))
      return typeMatches.get(key)!
    },
    storeLogo: vi.fn(async () => 'header-logos/2026/11/logo.png'),
    fallback: vi.fn(async () => ({
      ok: true as const,
      reply: 'I matched your brand.',
      design: defaultDesign(),
      applied: [],
      skipped: 0,
      outOfScope: false,
      readability: [],
    })),
    ...over,
  }
  const input = {
    design: defaultDesign(),
    shots: shots.map(({ img }) => ({
      analysis: dataUrl(img),
      strip: dataUrl({ width: W, height: 200, data: img.data.slice(0, W * 200 * 4) }),
      width: W,
      height: H,
    })),
    name: 'Acme',
    workspaceName: 'Acme Inc',
    allows: ALLOWS,
  }
  return { deps, input, order }
}

const near = (hex: unknown, c: Fill, de = 4) =>
  expect(deltaE00(parseColor(String(hex)) as RGB, c)).toBeLessThan(de)

async function run(over: Partial<BrandMatchDeps> = {}, thin = false, images = 1) {
  const { deps, input, order } = setup(over, thin, images)
  const steps: BrandStep[] = []
  const result = await brandMatch(input, deps, (s) => steps.push(s))
  return { result: result as BrandMatchResult, steps, order, deps }
}

const at = (result: BrandMatchResult, path: string) => result.applied.find((c) => c.path === path)

describe('brandMatch', () => {
  it('runs the stages in order, reporting each step', async () => {
    const { result, steps, order } = await run()
    expect(result.ok).toBe(true)
    expect(steps).toEqual(['read', 'measure', 'fonts', 'hero', 'words'])
    // The roles were settled by rule (one blue): no classifier call. The voice read starts
    // once the screenshots are read; the hero, asked twice at once so its answers can be
    // checked against each other, comes before the words: a set from each writing angle at
    // once, then the words critic's choice.
    expect(order).toEqual([
      'find',
      'voice',
      'hero',
      'hero',
      'words',
      'words',
      'words',
      'layout',
      'layout',
      'layout',
      'words_pick',
    ])
    expect(Object.keys(result.timings)).toEqual([
      'read',
      'measure',
      'fonts',
      'hero',
      'words',
      'apply',
    ])
  })

  it('reads every screenshot at once', async () => {
    let started = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((done) => (release = done))
    const { deps, input } = setup({}, false, 2)
    const find = deps.find
    deps.find = vi.fn(async (img: Image) => {
      started++
      if (started === 2) release()
      await gate
      return find(img)
    })
    const result = await brandMatch(input, deps)
    expect(started).toBe(2)
    expect(result.ok).toBe(true)
  })

  it('applies what was measured, each change with its evidence', async () => {
    const { result } = await run()
    near(at(result, 'brand.light.accent')?.after, BLUE)
    expect(at(result, 'shape.fill')?.after).toBe('accent')
    expect(result.design.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'inter' })
    expect(result.design.brand.fonts.headingWeight).toBe(700)
    expect(Math.abs(Number(at(result, 'tune.headline.size')?.after) / 48 - 1)).toBeLessThan(0.1)
    expect(at(result, 'layout.band')).toBeUndefined() // already none
    expect(at(result, 'pages.home.headline.title')?.after).toMatchObject({
      en: WORDS.home_headline,
    })
    expect(at(result, 'brand.logo.wordmark.light')?.after).toEqual({
      key: 'header-logos/2026/11/logo.png',
    })
    expect(at(result, 'brand.logo.display')?.after).toBe('wordmark')
    // The finer details: the subtitle in its own grey, section headings in the headline's ink.
    near(at(result, 'tune.subtitle.colour')?.after, GREY, 6)
    expect(at(result, 'tune.subtitle.colour')?.why).toMatch(/under your headline/)
    near(at(result, 'tune.heading.colour')?.after, INK, 6)
    expect(result.applied.every((c) => typeof c.why === 'string' && c.why.length > 3)).toBe(true)
    expect(result.logo).toMatchObject({ image: 0, full: true })
    expect(result.logo!.box.x).toBeGreaterThan(0.02)
    expect(result.reply).toMatch(/blue/)
    expect(result.notes.at(-1)).toMatch(/Your screenshots do not show hover effects/)
    expect(result.target?.measured?.fields.typeScale).toBe('display')
    // For the check: what was measured as a fingerprint, and every field set, unchanged ones too.
    expect(result.target?.fingerprint.headline?.size).toBeCloseTo(48, -1)
    expect(result.target?.fingerprint.page).toMatch(/^rgb\(/)
    expect(result.target?.paths).toContain('layout.band')
    expect(result.target?.paths).toContain('tune.headline.size')
    expect(result.target?.checkable).toBe(true)
  })

  it('sets a cream page from measurement and says so; a white page stays its own colour', async () => {
    const { deps, input } = setup({}, false, 1, null, [247, 243, 234])
    const cream = (await brandMatch(input, deps)) as BrandMatchResult
    expect(at(cream, 'layout.background')?.after).toEqual({ kind: 'tint', colour: '#f7f3ea' })
    expect(at(cream, 'layout.background')?.why).toMatch(/#f7f3ea/)
    expect(cream.reply).toContain('a soft cream page, as your site has')
    const { result: white } = await run()
    expect(at(white, 'layout.background')).toBeUndefined()
    expect(white.design.layout.background).toBeUndefined()
    expect(white.reply).not.toMatch(/page, as your site has/)
  })

  it('awaits the font stage, which runs off the request thread, within its budget', async () => {
    let deadline = 0
    const { result } = await run({
      matchType: async (shot, deadlineMs) => {
        deadline = deadlineMs
        await new Promise((done) => setTimeout(done, 20))
        const matched = matchType(shot)
        const lora = faceById('lora')!
        const h = matched.headline!
        return {
          ...matched,
          headline: { ...h, face: lora, alternatives: [{ ...h.alternatives[0]!, face: lora }] },
        }
      },
    })
    expect(deadline).toBeGreaterThan(0)
    expect(deadline).toBeLessThanOrEqual(BUDGET.fonts)
    expect(result.design.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'lora' })
  })

  it('leaves the type as it was when the font stage gives no match, and says so', async () => {
    const { result } = await run({ matchType: async () => ({ headline: null, body: null }) })
    expect(at(result, 'brand.fonts.heading')).toBeUndefined()
    expect(result.reply + result.notes.join(' ')).toMatch(/could not match your fonts/)
  })

  it('sets the headlines’ second part apart where the site’s headline is two-tone', async () => {
    const { deps, input } = setup({}, false, 1, [120, 130, 140])
    const result = (await brandMatch(input, deps)) as BrandMatchResult
    expect(result.design.pages.home.headline?.accent).toEqual({
      style: 'muted',
      text: { en: 'Acme builds next' },
    })
    const plain = await run()
    expect(plain.result.design.pages.home.headline?.accent).toBeUndefined()
  })

  it('offers follow-ups for the brand colour and the hero', async () => {
    const { result } = await run()
    expect(result.chips).toContain('Use more blue')
    expect(result.chips).toContain('Bolder hero')
  })

  it('asks for another screenshot when one shows no button or links', async () => {
    const { result } = await run({}, true)
    expect(result.asks[0]).toMatch(/Add a screenshot of a page from your product/)
  })

  it('settles a plain page’s hero by rule, without a hero call', async () => {
    const { deps, input, order } = setup()
    const find = deps.find
    deps.find = vi.fn(async (img: Image) => {
      const f = await find(img)
      return f && { ...f, output: { ...f.output, behind_headline: 'plain' as const } }
    })
    const result = (await brandMatch(input, deps)) as BrandMatchResult
    expect(order).toEqual([
      'find',
      'voice',
      'words',
      'words',
      'words',
      'layout',
      'layout',
      'layout',
      'words_pick',
    ])
    expect(result.notes.join(' ')).not.toMatch(/could not settle the hero/)
    expect(at(result, 'layout.band')).toBeUndefined()
  })

  it('keeps the measured hero when the hero call fails, and says so', async () => {
    const family = vi.fn(async <T>(request: FamilyRequest<T>) => {
      if (request.family === 'hero') throw new Error('model down')
      return answerOf(request.family) as T
    }) as unknown as BrandMatchDeps['family']
    const { result } = await run({ family })
    expect(result.ok).toBe(true)
    expect(result.notes.join(' ')).toMatch(/could not settle the hero/)
    expect(at(result, 'pages.feedback.headline.title')).toBeDefined()
  })

  it('asks for the words once more when no writer’s answer parses', async () => {
    let tries = 0
    const family = vi.fn(async <T>(request: FamilyRequest<T>) => {
      if (request.family !== 'words') return answerOf(request.family) as T
      if (++tries <= 3) throw new Error('Failed to parse structured output as JSON')
      return WORDS as T
    }) as unknown as BrandMatchDeps['family']
    const { result } = await run({ family })
    expect(tries).toBe(4)
    expect(at(result, 'pages.home.headline.title')?.after).toMatchObject({
      en: WORDS.home_headline,
    })
  })

  it('skips the words when time is short, keeping what is done', async () => {
    let t = 0
    const { deps, input } = setup()
    deps.now = () => t
    const family = deps.family
    deps.family = vi.fn(async <T>(request: FamilyRequest<T>) => {
      if (request.family === 'hero') t = 39_500
      return family(request)
    }) as unknown as BrandMatchDeps['family']
    const result = (await brandMatch(input, deps)) as BrandMatchResult
    expect(result.ok).toBe(true)
    expect(result.notes.join(' ')).toMatch(/could not write new words/)
    expect(at(result, 'pages.home.headline.title')).toBeUndefined()
    near(at(result, 'brand.light.accent')?.after, BLUE)
  })

  it('falls back to the whole-look match when no screenshot can be read', async () => {
    const { result, deps } = await run({ find: vi.fn(async () => null) })
    expect(deps.fallback).toHaveBeenCalledOnce()
    expect(result.reply).toMatch(/could not read your screenshots closely/)
  })

  it('places no logo when it cannot be stored, and says so', async () => {
    const { result } = await run({ storeLogo: vi.fn(async () => null) })
    expect(at(result, 'brand.logo.wordmark.light')).toBeUndefined()
    expect(result.logo).toBeNull()
    expect(result.notes.join(' ')).toMatch(/could not store the logo/)
  })
})

describe('the reply', () => {
  it('names colours as a person would', () => {
    expect(colourName('#0058a3')).toBe('blue')
    expect(colourName('#111111')).toBe('black')
    expect(colourName('#ffdb00')).toBe('yellow')
    expect(colourName('#533afd')).toBe('indigo')
  })

  it('offers no more of a colour a monochrome brand does not have', () => {
    const chips = followUps(
      {
        monochrome: true,
        intensity: 'quiet',
        identity: { value: '#111111', why: '', by: 'rule' },
        highlight: { value: null, why: '', by: 'rule' },
        action: { value: { role: 'ink', hex: '#111111' }, why: '', by: 'rule' },
        ask: null,
      } as never,
      'none'
    )
    expect(chips).toEqual(['Bolder hero'])
  })

  const blueBrand = (chosen: 'accent' | 'ink', site: 'accent' | 'ink' | 'support' | null) =>
    ({
      monochrome: false,
      intensity: 'medium',
      identity: { value: '#0058a3', why: '', by: 'rule' },
      highlight: { value: null, why: '', by: 'rule' },
      action: { value: { role: chosen, hex: '#0058a3' }, why: '', by: 'rule' },
      buttons: site,
      ask: null,
    }) as never

  it('offers no other button colour when the buttons are as the site has them', () => {
    expect(followUps(blueBrand('accent', 'accent'), 'none')).not.toContain('Black buttons')
    expect(followUps(blueBrand('ink', 'ink'), 'none')).not.toContain('Blue buttons')
  })

  it('offers the site’s own button colour when the design chose otherwise', () => {
    expect(followUps(blueBrand('accent', 'ink'), 'none')).toContain('Black buttons')
    expect(followUps(blueBrand('ink', 'accent'), 'none')).toContain('Blue buttons')
  })

  it('offers no button colour when no button was seen', () => {
    const chips = followUps(blueBrand('accent', null), 'none')
    expect(chips.some((c) => /buttons$/.test(c))).toBe(false)
  })

  it('says what the site’s buttons are filled with, measured', async () => {
    const { result } = await run()
    expect(result.target?.roles?.buttons).toBe('accent')
    expect(result.chips).not.toContain('Black buttons')
    const thin = await run({}, true)
    expect(thin.result.target?.roles?.buttons).toBeNull()
  })
})

describe('brandMatch with the brand’s site read', () => {
  const asset = (from: 'icon' | 'share') => ({
    url: `https://www.acme.test/${from}.png`,
    mime: 'image/png' as const,
    bytes: encodePng({ width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(200) }),
    width: 64,
    height: 64,
    from,
  })
  const site = {
    facts: {
      url: 'https://www.acme.test/',
      name: 'Acme Parcel',
      nameFrom: 'og:site_name' as const,
      language: 'en',
      description: 'Parcels delivered the same day.',
      themeColour: null,
      favicons: [],
      logos: [],
      shareImage: null,
      fonts: {
        heading: { family: 'Inter', stack: ['Inter'], generic: 'sans' as const, from: 'h1' },
        body: { family: 'Inter', stack: ['Inter'], generic: 'sans' as const, from: 'body' },
        faces: [],
        hosted: [],
      },
      colours: [],
      stylesheets: [],
      manifest: null,
    },
    favicon: asset('icon'),
    logo: null,
    shareImage: asset('share'),
    failed: null,
  }

  it('sets the site’s favicon and share picture, and its font, and leaves the voice read its own', async () => {
    const stored: string[] = []
    const { deps, input } = setup({
      storeAsset: vi.fn(async (_bytes: Uint8Array, _mime: string, kind: string) => {
        stored.push(kind)
        return `logos/2026/11/${kind}.png`
      }),
    })
    const result = (await brandMatch({ ...input, site }, deps)) as BrandMatchResult
    expect(stored.sort()).toEqual(['favicon', 'share'])
    expect(result.design.brand.favicon).toEqual({ key: 'logos/2026/11/favicon.png' })
    expect(result.design.brand.shareImage).toEqual({ key: 'logos/2026/11/share.png' })
    expect(result.design.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'inter' })
    expect(result.site).toMatchObject({ host: 'acme.test', favicon: true, shareImage: true })
    expect(result.notes.join(' ')).toContain('From acme.test: its favicon, its share picture.')
    // The voice read keeps its own evidence: the site's description and language are not in it.
    const voice = (deps.family as ReturnType<typeof vi.fn>).mock.calls
      .map(([r]) => r as FamilyRequest<unknown>)
      .find((r) => r.family === 'voice')!
    expect(voice.prompt).not.toContain('Parcels delivered the same day')
  })

  it('names the site’s own face it could only draw in the nearest, for the reply’s upload', async () => {
    const { deps, input } = setup({ storeAsset: vi.fn(async () => 'logos/x.png') })
    const own = { family: 'Acme Grotesk', stack: ['Acme Grotesk', 'sans-serif'] }
    const result = (await brandMatch(
      {
        ...input,
        site: {
          ...site,
          facts: {
            ...site.facts,
            fonts: {
              ...site.facts.fonts,
              heading: { ...site.facts.fonts.heading, ...own },
              body: { ...site.facts.fonts.body, ...own },
            },
          },
        },
      },
      deps
    )) as BrandMatchResult
    expect(result.font).toEqual({ family: 'Acme Grotesk', slot: 'both' })
  })

  it('names no face to upload when the site’s faces are bundled', async () => {
    const { deps, input } = setup({ storeAsset: vi.fn(async () => 'logos/x.png') })
    const result = (await brandMatch({ ...input, site }, deps)) as BrandMatchResult
    expect(result.font ?? null).toBeNull()
  })

  it('leaves a site read that met a bot wall out', async () => {
    const { deps, input } = setup({ storeAsset: vi.fn(async () => 'logos/x.png') })
    const result = (await brandMatch(
      { ...input, site: { ...site, failed: 'challenge' as const } },
      deps
    )) as BrandMatchResult
    expect(result.site ?? null).toBeNull()
    expect(deps.storeAsset).not.toHaveBeenCalled()
  })

  it('asks the voice read the same with a site read as without one', async () => {
    const voiceOf = async (withSite: boolean) => {
      const { deps, input } = setup({ storeAsset: vi.fn(async () => 'logos/x.png') })
      const result = (await brandMatch(
        withSite ? { ...input, site } : input,
        deps
      )) as BrandMatchResult
      expect(!!result.site).toBe(withSite)
      return (deps.family as ReturnType<typeof vi.fn>).mock.calls
        .map(([r]) => r as FamilyRequest<unknown>)
        .find((r) => r.family === 'voice')!.prompt
    }
    expect(await voiceOf(true)).toBe(await voiceOf(false))
  })
})
