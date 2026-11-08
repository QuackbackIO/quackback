/**
 * The hero photo in a brand match, on synthetic screenshots: a site leading
 * with a photo gets a crop of it as the hero's image, cut at the screenshot's
 * own resolution and stored as JPEG with the photo it came from, marked as
 * from the screenshot, its words taken out, veiled to read; a photo too small
 * to show is only offered; a plain page is offered nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import { MATCH_BRAND } from '@/lib/shared/design/match-brand'
import { defaultDesign } from '@/lib/shared/design/schema'
import { homeBlockTypes } from '@/lib/shared/design/home'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { FoundElements } from '../../extract/finder'
import type { FinderOutput } from '../../extract/finder-schema'
import { decodeJpeg, encodeJpeg } from '../../extract/jpeg'
import { BOX_KINDS, type Box, type BoxKind } from '../../extract/kinds'
import { encodePng, type Image } from '../../extract/png'
import { brandMatch, type BrandMatchDeps, type BrandMatchResult } from '../brand-match'
import type { FamilyRequest } from '../brand-brief'
import type { HeroAnswer } from '../hero-family'
import type { VoiceAnswer, WordsAnswer } from '../words-family'
import type { WordsPick } from '../words-pick'
import { photoAlt, photoChanges, photoStage, type BrandPhoto } from '../brand-photo'

type Fill = [number, number, number]
const W = 1200
const H = 800
const WHITE: Fill = [255, 255, 255]
const BLUE: Fill = [0, 88, 163]

function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** A photograph at a scale: soft light in many colours and sharp discs, the same scene at any scale. */
function scene(scale: number) {
  const rnd = random(3)
  const discs = Array.from({ length: 50 }, () => ({
    x: rnd() * W,
    y: rnd() * H,
    r: 8 + rnd() * 40,
    c: [rnd() * 255, rnd() * 255, rnd() * 255] as Fill,
  }))
  // Fine texture, as a photograph has at any scale: the same at each CSS pixel.
  const grain = (x: number, y: number) =>
    (((Math.floor(x) * 73856093) ^ (Math.floor(y) * 19349663)) % 13) - 6
  return (px: number, py: number): Fill => {
    const x = px / scale
    const y = py / scale
    const n = grain(x, y)
    for (let i = discs.length - 1; i >= 0; i--) {
      const d = discs[i]!
      if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.r * d.r) return d.c
    }
    return [
      90 + 70 * Math.sin(x / 97 + y / 151) + n,
      110 + 60 * Math.sin(x / 131 - y / 83 + 1) + n,
      100 + 80 * Math.cos(x / 173 + y / 59) + n,
    ]
  }
}

const inside = (x: number, y: number, b: Box) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3]

/** A page whose hero is a photo (`photo` in CSS px) behind centred white words, at a device scale. */
function page(photo: Box, scale = 1): Image {
  const w = W * scale
  const h = H * scale
  const paint = scene(scale)
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = inside(x / scale, y / scale, photo) ? paint(x, y) : WHITE
      data.set([...c, 255], (y * w + x) * 4)
    }
  const img = { width: w, height: h, data }
  const fill = (b: Box, c: Fill) => {
    for (let y = b[1] * scale; y < b[3] * scale; y++)
      for (let x = b[0] * scale; x < b[2] * scale; x++) data.set([...c, 255], (y * w + x) * 4)
  }
  fill([40, 24, 140, 56], BLUE)
  // White words over the photo: strokes 3px wide every 9px.
  for (let y = 300 * scale; y < 380 * scale; y++)
    for (let x = 380 * scale; x < 820 * scale; x++)
      if ((x / scale - 380) % 9 < 3 && (y / scale - 300) % 40 < 30)
        data.set([...WHITE, 255], (y * w + x) * 4)
  return img
}

const BOXES = (photo: Box): Partial<Record<BoxKind, Box | null>> => ({
  header: [0, 0, W, 80],
  logo: [40, 24, 140, 56],
  hero: [0, 80, W, photo[3]],
  headline: [380, 300, 820, 380],
  primary_button: null,
})

function found(
  boxes: Partial<Record<BoxKind, Box | null>>,
  behind: FinderOutput['behind_headline']
): FoundElements {
  const all = Object.fromEntries(BOX_KINDS.map((k) => [k, boxes[k] ?? null])) as Record<
    BoxKind,
    Box | null
  >
  const output: FinderOutput = {
    headline_text: 'Plan your trip',
    subtitle_text: '',
    logo_text: 'Acme',
    primary_button_text: '',
    section_heading_text: '',
    ...(Object.fromEntries(
      BOX_KINDS.map((k) => [k, boxes[k] ? boxes[k]!.join(' ') : 'none'])
    ) as Record<BoxKind, string>),
    behind_headline_evidence: 'a photo of a mountain lake at dawn, white words over it',
    behind_headline: behind,
    nav_style: 'plain',
    text_case: 'normal',
    logo_kind: 'wordmark',
    headline_type: 'sans',
    body_type: 'sans',
    cookie_banner: false,
    dimmed: false,
    main_cta_visible: false,
    product_screenshot_visible: false,
  }
  return { version: 'test', output, scale: 1, boxes: all, snapped: all }
}

const HERO: HeroAnswer = {
  evidence: 'A photo behind the words.',
  look: 'photo',
  shape: 'edge_to_edge',
  art: 'none',
  header_on_hero: 'separate',
  picture: 'behind_words',
  confidence: 'high',
}
const WORDS: WordsAnswer = {
  evidence: 'Plain.',
  home_layout: 'portal',
  home_headline: 'Shape what Acme builds next',
  home_subtitle: 'Ask for features and follow the roadmap.',
  feedback_headline: 'Help us build Acme',
  feedback_subtitle: 'Tell us what would help.',
  prompt: 'What would help you?',
  submit: 'Send',
}
const VOICE: VoiceAnswer = {
  evidence: 'Calm and outdoorsy.',
  name: 'Fernway',
  known: 'not',
  signatures: [],
  home_language: 'none',
  formality: 'neutral',
  humour: 'none',
  exclamations: 'never',
  emoji: 'never',
  vocabulary: [],
  avoid: [],
}
const PICK: WordsPick = { reviews: [], choice: 'a', swaps: [], why: '' }
const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  status: false,
  support: true,
} as PortalPageGates

const dataUrl = (img: Image) =>
  `data:image/png;base64,${Buffer.from(encodePng(img)).toString('base64')}`

/** Each match once: drawing a screenshot at twice its size takes a while. */
const matches = new Map<string, ReturnType<typeof matchOnce>>()
const match = (photo: Box, behind: FinderOutput['behind_headline'] = 'photo') => {
  const key = `${photo.join()}-${behind}`
  if (!matches.has(key)) matches.set(key, matchOnce(photo, behind))
  return matches.get(key)!
}

async function matchOnce(photo: Box, behind: FinderOutput['behind_headline']) {
  const analysis = page(photo)
  const native = page(photo, 2)
  const stored: Array<{ name: string; bytes: Uint8Array }> = []
  const deps: BrandMatchDeps = {
    find: vi.fn(async () => found(BOXES(photo), behind)),
    roles: null,
    family: vi.fn(
      async <T>(request: FamilyRequest<T>) =>
        (request.family === 'hero'
          ? HERO
          : request.family === 'voice'
            ? VOICE
            : request.family === 'words_pick'
              ? PICK
              : WORDS) as T
    ) as unknown as BrandMatchDeps['family'],
    storeLogo: vi.fn(async () => 'header-logos/2026/11/logo.png'),
    storePhoto: vi.fn(async (bytes: Uint8Array, name: string) => {
      stored.push({ name, bytes })
      return `portal-images/2026/11/${name}`
    }),
    fallback: vi.fn(),
    matchType: async () => ({ headline: null, body: null }),
  }
  const result = (await brandMatch(
    {
      design: defaultDesign(),
      shots: [
        {
          analysis: dataUrl(analysis),
          // The top of the page only, at twice the CSS pixels: it does not hold the photo.
          strip: dataUrl(cropTop(native, 200)),
          hero: `data:image/jpeg;base64,${Buffer.from(encodeJpeg(native, 92)).toString('base64')}`,
          width: W * 2,
          height: H * 2,
        },
      ],
      name: 'Acme',
      workspaceName: 'Acme',
      allows: { blockTypes: homeBlockTypes(GATES), gates: GATES, checkCss: () => 'no CSS' },
    },
    deps
  )) as BrandMatchResult
  return { result, stored, deps }
}

function cropTop(img: Image, rows: number): Image {
  return { width: img.width, height: rows, data: img.data.slice(0, img.width * rows * 4) }
}

const at = (result: BrandMatchResult, path: string) => result.applied.find((c) => c.path === path)

describe('a brand match on a site that leads with a photo', { timeout: 60_000 }, () => {
  it('puts a crop of the photo behind the words, from the sharpest source, marked as from the screenshot', async () => {
    const { result, stored } = await match([0, 80, W, 700])
    expect(result.ok).toBe(true)
    // The crop and the photo it came from, as JPEG at the screenshot's own resolution.
    expect(stored.map((s) => s.name).sort()).toEqual(['hero-source.jpg', 'hero.jpg'])
    const crop = decodeJpeg(stored.find((s) => s.name === 'hero.jpg')!.bytes)
    expect(crop.width).toBeGreaterThan(2000)
    const image = at(result, 'brand.heroImage')?.after as Record<string, unknown>
    expect(image).toMatchObject({
      key: 'portal-images/2026/11/hero.jpg',
      alt: 'A mountain lake at dawn',
      screenshot: { key: 'portal-images/2026/11/hero-source.jpg' },
    })
    expect((image.shade as { tone: string }).tone).toMatch(/dark|light/)
    expect(at(result, 'layout.imagePlace')?.after).toBe('cover')
    expect(result.design.layout.hero).not.toBe('none')
    expect(result.design.layout.imagePoint).toBeDefined()
    // The words reach 4.5:1 on the veiled photo: no readability problem left.
    expect(result.readability).toEqual([])
    expect(result.notes).toContainEqual(
      expect.stringMatching(/cut from your screenshot: replace it with the original/)
    )
    expect(result.chips[0]).toBe(MATCH_BRAND.addHeroPhoto)
  })

  it('takes the site’s words out of the photo it keeps', async () => {
    const { stored } = await match([0, 80, W, 700])
    const crop = decodeJpeg(stored.find((s) => s.name === 'hero.jpg')!.bytes)
    // Where the white strokes were (at twice the CSS pixels, from the crop's top at 80), nothing is near white.
    let white = 0
    for (let y = (300 - 80) * 2; y < (380 - 80) * 2; y += 3)
      for (let x = 380 * 2; x < 820 * 2; x += 3) {
        const i = (y * crop.width + x) * 4
        if (crop.data[i]! > 240 && crop.data[i + 1]! > 240 && crop.data[i + 2]! > 240) white++
      }
    expect(white).toBe(0)
  })

  it('offers a photo, without storing one, when the photo is too small to show', async () => {
    const { result, stored } = await match([600, 200, 1000, 520], 'photo')
    expect(stored).toEqual([])
    expect(at(result, 'brand.heroImage')).toBeUndefined()
    expect(result.chips).toContain(MATCH_BRAND.addHeroPhoto)
    expect(result.notes.join(' ')).toMatch(/leads with a photo/)
  })

  it('offers nothing on a page with no photo', async () => {
    const { result, stored } = await match([0, 0, 0, 0], 'plain')
    expect(stored).toEqual([])
    expect(result.chips).not.toContain(MATCH_BRAND.addHeroPhoto)
  })
})

describe('photoAlt', () => {
  it('describes the photo from the finder’s words on it', () => {
    expect(photoAlt('dark brown photo of a hand holding a phone with peaches, darker area')).toBe(
      'A hand holding a phone with peaches'
    )
    expect(photoAlt('a full-width photograph of a living room')).toBe('A living room')
    expect(photoAlt('a man at a laptop with a bright office wall behind the headline text')).toBe(
      'A man at a laptop with a bright office wall'
    )
    expect(photoAlt('')).toBe('')
  })
})

describe('photoChanges', () => {
  const plan = {
    region: [0, 80, 1200, 700] as Box,
    crop: [0, 80, 1200, 500] as Box,
    place: 'cover' as const,
    wordsOn: true,
    soften: [],
    joinsHeader: true,
    marked: false,
    why: 'a photo fills the hero behind the words',
  }
  const placed: BrandPhoto['placed'] = {
    key: 'k',
    source: 's',
    box: { x: 0, y: 0, w: 1, h: 0.68 },
    focus: { x: 80, y: 40 },
    shade: { tone: 'dark', strength: 40, under: '#333333' },
    alt: 'A lake',
  }
  it('sets the image behind the words on a full coloured band, on Home only, the header its own', () => {
    const changes = photoChanges({ led: true, plan, quality: null, placed }, 'none')
    const value = (path: string) => changes.find((c) => c.path === path)?.value
    expect(value('layout.hero')).toBe('brand')
    expect(value('layout.heroShape')).toBe('full')
    // On Home only: the other pages' heroes stay short and the picture does not repeat; the
    // header keeps its own colour on them, so it is not drawn on the photo.
    expect(value('brand.heroImage')).toMatchObject({ homeOnly: true })
    expect(value('layout.headerOnHero')).toBe(false)
    expect(value('layout.imageFocus')).toBe('right')
    expect(value('layout.imagePoint')).toEqual({ x: 80, y: 40 })
    expect(changes.find((c) => c.path === 'brand.heroImage')?.why).toMatch(
      /replace it with the original/
    )
  })
  it('keeps only where a photo would sit when none was placed', () => {
    const changes = photoChanges({ led: true, plan, quality: null, placed: null }, 'brand')
    expect(changes.map((c) => c.path)).toEqual(['layout.imagePlace'])
  })
})

describe('a photo an earlier match cut from another screenshot', () => {
  const had = {
    key: 'portal-images/old.jpg',
    screenshot: { key: 'portal-images/old-source.jpg', box: { x: 0, y: 0, w: 1, h: 1 } },
  }
  it('goes when this match places none, so one brand’s photo never stays on another', () => {
    const changes = photoChanges(
      { led: false, plan: null, quality: null, placed: null },
      'none',
      had
    )
    expect(changes.map((c) => [c.path, c.value])).toEqual([
      ['brand.heroImage', null],
      ['layout.imagePoint', null],
      ['layout.imageFocus', null],
    ])
  })
  it('stays when the customer uploaded it', () => {
    expect(
      photoChanges({ led: false, plan: null, quality: null, placed: null }, 'none', {
        key: 'portal-images/team.jpg',
      })
    ).toEqual([])
  })
})

describe('a photo in a screenshot under a pop-up’s dimming', () => {
  it('is offered, never cut, as the builder warned it was dimmed', async () => {
    const photo: Box = [0, 80, W, 700]
    const img = page(photo)
    const store = vi.fn(async () => 'portal-images/x.jpg')
    const shot = {
      index: 0,
      img,
      strip: null,
      width: W,
      height: H,
      found: found(BOXES(photo), 'photo'),
      told: { dimmed: true },
    }
    const dimmed = await photoStage(shot, store, 10_000, 10_000)
    expect(store).not.toHaveBeenCalled()
    expect(dimmed.placed).toBeNull()
    expect(dimmed.led).toBe(true)
    expect(dimmed.quality?.why).toMatch(/dimmed/)
    // The same screenshot, clean: cut.
    const clean = await photoStage({ ...shot, told: undefined }, store, 10_000, 10_000)
    expect(clean.placed).not.toBeNull()
  }, 60_000)
})

describe('what is placed', () => {
  it('only a photo the finder saw behind the headline: a picture beside words on a plain page is offered', async () => {
    const photo: Box = [600, 140, 1160, 700]
    const img = page(photo)
    const store = vi.fn(async () => 'portal-images/x.jpg')
    const shot = {
      index: 0,
      img,
      strip: null,
      width: W,
      height: H,
      found: found(
        { ...BOXES(photo), headline: [80, 300, 520, 380], hero: [0, 80, W, 720] },
        'plain'
      ),
    }
    const offered = await photoStage(shot, store, 10_000, 10_000)
    expect(store).not.toHaveBeenCalled()
    expect(offered.placed).toBeNull()
  }, 60_000)

  it('never from a screenshot with a cookie banner, which a crop could carry', async () => {
    const photo: Box = [0, 80, W, 700]
    const store = vi.fn(async () => 'portal-images/x.jpg')
    const f = found(BOXES(photo), 'photo')
    f.output.cookie_banner = true
    const shot = { index: 0, img: page(photo), strip: null, width: W, height: H, found: f }
    const offered = await photoStage(shot, store, 10_000, 10_000)
    expect(offered.placed).toBeNull()
    expect(offered.led).toBe(true)
    expect(store).not.toHaveBeenCalled()
  }, 60_000)

  it('never a gradient or a plain panel the finder called a photo', async () => {
    const photo: Box = [0, 80, W, 700]
    const store = vi.fn(async () => 'portal-images/x.jpg')
    for (const evidence of [
      'colourful gradient swirl to the right of the headline',
      'plain white panel behind the words',
    ]) {
      const f = found(BOXES(photo), 'photo')
      f.output.behind_headline_evidence = evidence
      const shot = { index: 0, img: page(photo), strip: null, width: W, height: H, found: f }
      expect((await photoStage(shot, store, 10_000, 10_000)).placed).toBeNull()
    }
    expect(store).not.toHaveBeenCalled()
  }, 60_000)

  it('never one carrying the site’s own seal beside the words, which no crop leaves out', async () => {
    const photo: Box = [0, 80, W, 700]
    const store = vi.fn(async () => 'portal-images/x.jpg')
    const img = page(photo)
    // A seal on the photo beside the words: a white plate with small dark type.
    for (let y = 300; y < 360; y++)
      for (let x = 960; x < 1080; x++) {
        const type = y >= 308 && y < 352 && x >= 968 && x < 1072 && (x - 960) % 5 < 2
        img.data.set(type ? [20, 20, 20, 255] : [255, 255, 255, 255], (y * W + x) * 4)
      }
    const shot = {
      index: 0,
      img,
      strip: null,
      width: W,
      height: H,
      found: found(BOXES(photo), 'photo'),
    }
    const offered = await photoStage(shot, store, 10_000, 10_000)
    expect(offered.placed).toBeNull()
    expect(offered.led).toBe(true)
    expect(offered.quality?.why).toMatch(/labels or badges/)
    expect(store).not.toHaveBeenCalled()
  }, 60_000)
})
