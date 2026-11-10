/**
 * Colour roles on synthetic pages with known answers: a brand-coloured
 * button, black buttons beside a coloured logo, a photo hero that never
 * lends its colours, thin evidence (Hemla-like: logo and photos only), and a
 * monochrome site whose product picture shows an accent (Tidewell-like). Then
 * the classifier's examples against its schema, the classifier filling only
 * what rules left open, and the mapping into design fields.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign } from '@/lib/shared/design/schema'
import { deltaE00, parseColor, type RGB } from '../color'
import type { Box, BoxKind } from '../kinds'
import type { Image } from '../png'
import { colourEvidence, decideRoles, sameColour, type ShotInput } from '../roles'
import {
  ACTION_CHOICES,
  classifyRoles,
  ROLES_EXAMPLES,
  rolesPrompt,
  rolesSchema,
  type RolesCaller,
} from '../roles-classifier'
import { rolesToDesign } from '../roles-design'

type Fill = [number, number, number]
const W = 960
const H = 600

function canvas(bg: Fill): Image {
  const data = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4)
  return { width: W, height: H, data }
}
function rect(img: Image, [x0, y0, x1, y1]: Box, c: Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}
const mixC = (a: Fill, b: Fill, t: number): Fill =>
  [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Fill
/** Type: 2px strokes with a blended pixel either side, in words. */
function text(img: Image, [x0, y0, x1, y1]: Box, ink: Fill, under: Fill) {
  for (let x = x0; x + 3 < x1; x += 6) {
    if (Math.floor((x - x0) / 36) % 4 === 3) continue
    rect(img, [x, y0, x + 1, y1], mixC(under, ink, 0.4))
    rect(img, [x + 1, y0, x + 3, y1], ink)
    rect(img, [x + 3, y0, x + 4, y1], mixC(under, ink, 0.6))
  }
}
const noise = (x: number, y: number): Fill => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return [h & 255, (h >>> 8) & 255, (h >>> 16) & 255]
}
function photo(img: Image, [x0, y0, x1, y1]: Box) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([...noise(x, y), 255], (y * W + x) * 4)
}

const WHITE: Fill = [255, 255, 255]
const INK: Fill = [17, 17, 17]
const GREY: Fill = [90, 90, 90]
const BLUE: Fill = [0, 88, 163]
const YELLOW: Fill = [255, 219, 0]
const CORAL: Fill = [255, 79, 64]
const NAVY: Fill = [17, 34, 49]
const INDIGO: Fill = [94, 106, 210]

interface PageSpec {
  logo: (img: Image, b: Box) => void
  button?: Fill
  buttonInk?: Fill
  heroPhoto?: boolean
  product?: (img: Image, b: Box) => void
}

const BOX: Record<string, Box> = {
  header: [0, 0, W, 64],
  logo: [32, 20, 112, 44],
  nav_row: [160, 26, 460, 38],
  primary_button: [780, 16, 920, 48],
  hero: [0, 64, W, 420],
  headline: [64, 140, 520, 180],
  subtitle: [64, 200, 460, 212],
  product_screenshot: [560, 110, 920, 380],
}

/** A page: header with logo, menu and maybe a button; a hero with a headline; maybe a product picture. */
function page(spec: PageSpec): ShotInput {
  const img = canvas(WHITE)
  spec.logo(img, BOX.logo!)
  text(img, BOX.nav_row!, GREY, WHITE)
  if (spec.button) {
    rect(img, BOX.primary_button!, spec.button)
    text(img, [800, 26, 900, 38], spec.buttonInk ?? WHITE, spec.button)
  }
  if (spec.heroPhoto) photo(img, BOX.hero!)
  text(img, BOX.headline!, spec.heroPhoto ? WHITE : INK, spec.heroPhoto ? INK : WHITE)
  if (!spec.heroPhoto) text(img, BOX.subtitle!, GREY, WHITE)
  if (spec.product) spec.product(img, BOX.product_screenshot!)
  const boxes: Partial<Record<BoxKind, Box | null>> = {
    header: BOX.header!,
    logo: BOX.logo!,
    nav_row: BOX.nav_row!,
    hero: BOX.hero!,
    headline: BOX.headline!,
    subtitle: spec.heroPhoto ? null : BOX.subtitle!,
    primary_button: spec.button ? BOX.primary_button! : null,
    product_screenshot: spec.product ? BOX.product_screenshot! : null,
  }
  return { img, boxes, behind: spec.heroPhoto ? 'photo' : 'plain' }
}

const solidLogo = (c: Fill) => (img: Image, b: Box) => rect(img, b, c)
const near = (hex: string | null | undefined, c: Fill, de = 3) => {
  expect(hex).toBeTruthy()
  expect(deltaE00(parseColor(hex!) as RGB, c)).toBeLessThan(de)
}

const LAVENDER: Fill = [184, 194, 253]
const PURPLE: Fill = [124, 58, 237]

/** A lavender page whose hero fades to deep pink: the header on the gradient's pale stop, a purple mark and button. */
function lavenderGradient() {
  // A lavender page whose hero fades to deep pink on the right: the header sits on the
  // gradient's pale stop. A purple mark beside dark lettering, a purple button; no header button.
  const PINK: Fill = [240, 110, 170]
  const img = canvas(WHITE)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = y < 64 ? 0 : Math.min(1, Math.max(0, (x - 600) / 200))
      img.data.set([...mixC(LAVENDER, PINK, t), 255], (y * W + x) * 4)
    }
  rect(img, [32, 20, 56, 44], PURPLE)
  text(img, [62, 24, 112, 40], NAVY, LAVENDER)
  text(img, BOX.nav_row!, INK, LAVENDER)
  text(img, BOX.headline!, INK, LAVENDER)
  rect(img, [64, 300, 240, 348], PURPLE)
  text(img, [80, 318, 220, 330], WHITE, PURPLE)
  return colourEvidence([
    {
      img,
      boxes: {
        header: BOX.header!,
        logo: BOX.logo!,
        nav_row: BOX.nav_row!,
        hero: [0, 64, W, H],
        headline: BOX.headline!,
        primary_button: [64, 300, 240, 348],
      },
      behind: 'gradient',
    },
  ])
}

describe('colour roles by rule', () => {
  it('a brand-coloured button and logo: the brand colour everywhere, by rule', () => {
    const shot = page({ logo: solidLogo(BLUE), button: BLUE })
    const roles = decideRoles(colourEvidence([shot]))
    near(roles.identity.value, BLUE)
    expect(roles.identity.by).toBe('rule')
    expect(roles.action.value.role).toBe('accent')
    expect(roles.links.value.role).toBe('accent')
    expect(roles.tint.value).toBe('neutral')
    expect(roles.monochrome).toBe(false)
    expect(roles.open).toEqual([])
    expect(roles.ask).toBeNull()
  })

  it('black buttons beside a coloured logo: identity from the logo, actions in the text colour', () => {
    const shot = page({ logo: solidLogo(CORAL), button: NAVY })
    const roles = decideRoles(colourEvidence([shot]))
    near(roles.identity.value, CORAL)
    expect(roles.action.value.role).toBe('ink')
    near(roles.action.value.hex, NAVY)
    // The navy is tinted: it is the second colour.
    near(roles.highlight.value, NAVY)
  })

  it('a photo hero never lends its colours: a grey site stays monochrome', () => {
    const shot = page({ logo: solidLogo(INK), button: INK, heroPhoto: true })
    const ev = colourEvidence([shot])
    expect(ev.candidates.filter((c) => !c.neutral)).toEqual([])
    const roles = decideRoles(ev)
    expect(roles.monochrome).toBe(true)
    near(roles.identity.value, INK)
    expect(roles.links.value.role).toBe('ink')
  })

  it('a coloured button in the header counts though the header was boxed short or not at all', () => {
    // Black main button, black logo, and one lime button at the header's right: the lime is the brand's.
    const LIME: Fill = [238, 241, 124]
    const shot = page({ logo: solidLogo(INK), button: LIME, buttonInk: INK })
    rect(shot.img, [64, 330, 200, 362], INK)
    text(shot.img, [80, 342, 184, 350], WHITE, INK)
    const boxes = { ...shot.boxes, primary_button: [64, 330, 200, 362] as Box }
    const whole = decideRoles(colourEvidence([{ ...shot, boxes }]))
    expect(whole.monochrome).toBe(false)
    near(whole.identity.value, LIME)
    for (const header of [null, [0, 0, 600, 64] as Box]) {
      const roles = decideRoles(colourEvidence([{ ...shot, boxes: { ...boxes, header } }]))
      expect(roles.monochrome).toBe(false)
      near(roles.identity.value, LIME)
      expect(roles.action.value.role).toBe('ink')
    }
  })

  it('a frosted grey chip over a photo hero is not the site’s button colour', () => {
    // A monochrome site whose only button-like shape is a translucent grey chip on the photo.
    const shot = page({ logo: solidLogo(INK), heroPhoto: true })
    const CHIP: Box = [380, 230, 580, 262]
    rect(shot.img, CHIP, [198, 198, 196])
    text(shot.img, [396, 240, 564, 252], INK, [198, 198, 196])
    const roles = decideRoles(
      colourEvidence([{ ...shot, boxes: { ...shot.boxes, primary_button: CHIP } }])
    )
    expect(roles.monochrome).toBe(true)
    // Actions in the site's text colour (its menu's grey here), never the photo-tinted chip.
    expect(roles.action.value.role).toBe('ink')
    near(roles.action.value.hex, GREY)
    // A grey button on the plain page is the site's own grey.
    const plain = page({ logo: solidLogo(INK), button: [198, 198, 196], buttonInk: INK })
    expect(decideRoles(colourEvidence([plain])).action.value.role).toBe('neutral')
  })

  it('a blurred photo behind the whole page lends no colour to the logo, header or sections', () => {
    // A soft photo (smooth browns and purples, no texture) under a header and hero; a white
    // wordmark, white menu and headline, a white button: a black and white site on a photo.
    const img = canvas(WHITE)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = x / W
        const w = Math.sin(x / 37) * Math.cos(y / 23)
        img.data.set(
          [
            Math.round(124 + 50 * t + 18 * w),
            Math.round(79 + 20 * Math.sin(y / 17) + 12 * w),
            Math.round(58 + 70 * t - 10 * w),
            255,
          ],
          (y * W + x) * 4
        )
      }
    const logo: Box = [420, 18, 540, 46]
    text(img, [428, 24, 532, 40], WHITE, [150, 90, 80])
    text(img, BOX.nav_row!, WHITE, [140, 90, 70])
    rect(img, BOX.primary_button!, WHITE)
    text(img, [800, 26, 900, 38], INK, WHITE)
    text(img, BOX.headline!, WHITE, [140, 90, 70])
    const ev = colourEvidence([
      {
        img,
        boxes: {
          header: BOX.header!,
          logo,
          nav_row: BOX.nav_row!,
          hero: [0, 64, W, H],
          headline: BOX.headline!,
          primary_button: BOX.primary_button!,
        },
        behind: 'photo',
      },
    ])
    const brown = ev.candidates.filter(
      (c) =>
        !c.neutral &&
        c.sightings.some((s) =>
          ['logo', 'logo_field', 'surface', 'header_band', 'hero_surface'].includes(s.source)
        )
    )
    expect(brown.map((c) => c.hex)).toEqual([])
    const roles = decideRoles(ev)
    expect(roles.monochrome).toBe(true)
    // Black and white on a light portal: the identity is the dark ink, not the white type on the photo.
    expect(roles.scheme).toBe('light')
    expect(deltaE00(parseColor(roles.identity.value) as RGB, INK)).toBeLessThan(10)
    expect(ev.shots[0]!.logoColours.every((h) => deltaE00(parseColor(h) as RGB, WHITE) < 10)).toBe(
      true
    )
  })

  it('a pale tint behind the hero is never the identity when the logo has a saturated colour', () => {
    const PEACH: Fill = [251, 217, 181]
    const VIVID: Fill = [0, 107, 255]
    const shot = page({ logo: solidLogo(VIVID), button: INK })
    rect(shot.img, BOX.hero!, PEACH)
    text(shot.img, BOX.headline!, INK, PEACH)
    const ev = colourEvidence([shot])
    const roles = decideRoles(ev)
    near(roles.identity.value, VIVID)
    // Nor when the classifier chose it.
    near(decideRoles(ev, { identity: '#fbd9b5' }).identity.value, VIVID)
  })

  it("a gradient's pale stop behind the header and hero never outranks a saturated button and logo", () => {
    const ev = lavenderGradient()
    // The header on the gradient is the gradient, not a header band of its own.
    const lav = ev.candidates.find((c) => deltaE00(c.rgb, LAVENDER) < 7)
    expect(lav?.sightings.map((s) => s.source)).not.toContain('header_band')
    const roles = decideRoles(ev)
    near(roles.identity.value, PURPLE, 5)
    expect(roles.action.value.role).toBe('accent')
    // Nor when the classifier chose the stop.
    near(decideRoles(ev, { identity: '#b8c2fd' }).identity.value, PURPLE, 5)
  })

  it('keeps a pale signature tint where the logo and buttons are only black', () => {
    const PEACH: Fill = [251, 217, 181]
    const shot = page({ logo: solidLogo(INK), button: INK })
    rect(shot.img, BOX.hero!, PEACH)
    text(shot.img, BOX.headline!, INK, PEACH)
    near(decideRoles(colourEvidence([shot])).identity.value, PEACH)
  })

  it('thin evidence (logo and photos only) asks for one more screenshot', () => {
    const logo = (img: Image, b: Box) => {
      rect(img, b, BLUE)
      rect(img, [b[0] + 12, b[1] + 6, b[2] - 12, b[3] - 6], YELLOW)
      for (let x = b[0] + 16; x < b[2] - 16; x += 10)
        rect(img, [x, b[1] + 6, x + 4, b[3] - 6], BLUE)
    }
    const roles = decideRoles(colourEvidence([page({ logo, heroPhoto: true })]))
    expect(roles.ask?.kind).toBe('thin')
    expect(roles.ask && 'missing' in roles.ask && roles.ask.missing).toContain('main button')
    // Without a button, actions take the most recognisable colour.
    expect(roles.action.value.role).toBe('accent')
    expect(roles.action.by).toBe('default')
  })

  it('a monochrome site whose product picture shows an accent asks, and stays monochrome', () => {
    const product = (img: Image, b: Box) => {
      rect(img, b, [246, 246, 248])
      rect(img, [b[0], b[1], b[0] + 80, b[3]], [28, 28, 32])
      rect(img, [b[0] + 100, b[1] + 30, b[0] + 220, b[1] + 54], INDIGO)
      text(img, [b[0] + 108, b[1] + 38, b[0] + 210, b[1] + 46], WHITE, INDIGO)
      text(img, [b[0] + 100, b[1] + 80, b[0] + 300, b[1] + 92], INDIGO, [246, 246, 248])
    }
    const roles = decideRoles(
      colourEvidence([page({ logo: solidLogo(INK), button: INK, product })])
    )
    expect(roles.monochrome).toBe(true)
    near(roles.identity.value, INK)
    expect(roles.ask?.kind).toBe('conflict')
    near(roles.ask && 'app' in roles.ask ? roles.ask.app : null, INDIGO, 5)
  })

  it("a black and white site's one vivid mark is its signature accent; its buttons stay black", () => {
    // A mark in the hero a little over 1% of the page, the only colour the site shows.
    const GREEN: Fill = [1, 210, 47]
    const shot = page({ logo: solidLogo(INK), button: INK })
    rect(shot.img, [700, 150, 800, 280], GREEN)
    const roles = decideRoles(colourEvidence([shot]))
    expect(roles.monochrome).toBe(false)
    near(roles.identity.value, GREEN)
    expect(roles.identity.by).toBe('rule')
    expect(roles.action.value.role).toBe('ink')
    near(roles.action.value.hex, INK)
    // Too light to read as text on white: links stay in the text colour.
    expect(roles.links.value.role).toBe('ink')
    expect(roles.ask).toBeNull()
  })

  it('a signature accent dark enough to read marks the links; without a button, buttons are black', () => {
    const RED: Fill = [208, 71, 65]
    const shot = page({ logo: solidLogo(INK) })
    rect(shot.img, [600, 260, 760, 330], RED)
    const roles = decideRoles(colourEvidence([shot]))
    near(roles.identity.value, RED)
    expect(roles.action.value.role).toBe('ink')
    expect(roles.links.value.role).toBe('accent')
  })

  it('a faint tint, a speck or a colour only in the product picture is no signature accent', () => {
    const PEACH: Fill = [250, 210, 170]
    const faint = page({ logo: solidLogo(INK), button: INK })
    rect(faint.img, [700, 150, 800, 280], PEACH)
    expect(decideRoles(colourEvidence([faint])).monochrome).toBe(true)
    const speck = page({ logo: solidLogo(INK), button: INK })
    rect(speck.img, [700, 150, 712, 162], [1, 210, 47])
    expect(decideRoles(colourEvidence([speck])).monochrome).toBe(true)
    const product = (img: Image, b: Box) => {
      rect(img, b, [246, 246, 248])
      rect(img, [b[0] + 100, b[1] + 30, b[0] + 220, b[1] + 130], INDIGO)
    }
    const app = decideRoles(colourEvidence([page({ logo: solidLogo(INK), button: INK, product })]))
    expect(app.monochrome).toBe(true)
  })

  it('weights the product picture low, not zero, beside a site colour', () => {
    const product = (img: Image, b: Box) => {
      rect(img, [b[0] + 20, b[1] + 20, b[0] + 200, b[1] + 60], INDIGO)
      text(img, [b[0] + 30, b[1] + 34, b[0] + 190, b[1] + 46], WHITE, INDIGO)
    }
    const ev = colourEvidence([page({ logo: solidLogo(CORAL), button: CORAL, product })])
    const app = ev.candidates.find((c) => deltaE00(c.rgb, INDIGO) < 5)
    expect(app?.sightings.map((s) => s.source)).toContain('product')
    const roles = decideRoles(ev)
    near(roles.identity.value, CORAL)
    expect(roles.ask).toBeNull()
  })

  it("takes a logo's field over the lettering on it, even when the lettering covers more", () => {
    const logo = (img: Image, b: Box) => {
      rect(img, b, BLUE)
      // Heavy yellow lettering: more yellow than blue.
      for (let x = b[0] + 4; x < b[2] - 4; x += 5) rect(img, [x, b[1] + 3, x + 4, b[3] - 3], YELLOW)
    }
    const ev = colourEvidence([page({ logo, heroPhoto: true })])
    const blue = ev.candidates.find((c) => deltaE00(c.rgb, BLUE) < 3)
    expect(blue?.sightings.map((s) => s.source)).toContain('logo_field')
    near(decideRoles(ev).identity.value, BLUE)
  })

  it('tells shades of one colour from two colours', () => {
    expect(sameColour('#ff385c', '#da134a')).toBe(true)
    expect(sameColour('#0058a3', '#ffdb00')).toBe(false)
    expect(sameColour('#730394', '#4a154b')).toBe(false)
  })
})

describe('colour roles classifier', () => {
  it('has examples that parse against its schema and name candidates they list', () => {
    for (const e of ROLES_EXAMPLES) {
      const a = rolesSchema.parse(e.answer)
      const ids = e.evidence.map((l) => /^(c\d+) /.exec(l)?.[1]).filter(Boolean)
      expect(ids).toContain(a.identity)
      if (a.highlight !== 'none') expect(ids).toContain(a.highlight)
      expect(ACTION_CHOICES).toContain(a.action)
    }
  })

  const twoColourLogo = () => {
    const logo = (img: Image, b: Box) => {
      rect(img, [b[0], b[1], (b[0] + b[2]) / 2, b[3]], BLUE)
      rect(img, [(b[0] + b[2]) / 2, b[1], b[2], b[3]], YELLOW)
    }
    return page({ logo, heroPhoto: true })
  }

  it('fills only what the rules left open, with the candidate it names', async () => {
    const shot = twoColourLogo()
    const ev = colourEvidence([shot])
    const roles = decideRoles(ev)
    expect(roles.open).toContain('identity')
    const yellow = ev.candidates.find((c) => deltaE00(c.rgb, YELLOW) < 3)!
    const blue = ev.candidates.find((c) => deltaE00(c.rgb, BLUE) < 3)!
    let prompt = ''
    let images = 0
    const call: RolesCaller = async (req) => {
      prompt = req.prompt
      images = req.images.length
      return {
        evidence: 'yellow leads',
        identity: yellow.id,
        action: 'brand_colour',
        highlight: blue.id,
        confidence: 'high',
      }
    }
    const out = await classifyRoles(ev, roles, call, [shot])
    near(out.identity.value, YELLOW)
    expect(out.identity.by).toBe('model')
    near(out.highlight.value, BLUE)
    expect(out.open).toEqual([])
    expect(images).toBe(1)
    // The prompt lists the candidates and the worked examples.
    expect(prompt).toContain(yellow.hex)
    expect(prompt).toContain('Example (Petalpost)')
    expect(rolesPrompt(ev, roles, true)).toBe(prompt)
  })

  it('keeps the rules when the answer has low confidence', async () => {
    const shot = twoColourLogo()
    const ev = colourEvidence([shot])
    const roles = decideRoles(ev)
    const other = ev.candidates.find((c) => !c.neutral && c.hex !== roles.identity.value)!
    const out = await classifyRoles(ev, roles, async () => ({
      evidence: 'unsure',
      identity: other.id,
      action: 'grey',
      highlight: 'none',
      confidence: 'low',
    }))
    expect(out.identity.value).toBe(roles.identity.value)
    expect(out.open).toEqual([])
  })

  it("keeps a gradient hero's stop as the second colour when the model names none", async () => {
    const ev = lavenderGradient()
    const ruled = decideRoles(ev)
    expect(ruled.hero.look).toBe('gradient')
    expect(ruled.highlight.value).toBeTruthy()
    const purple = ev.candidates.find((c) => deltaE00(c.rgb, PURPLE) < 5)!
    const out = await classifyRoles(ev, { ...ruled, open: ['identity'] }, async () => ({
      evidence: 'purple logo and buttons',
      identity: purple.id,
      action: 'brand_colour',
      highlight: 'none',
      confidence: 'high',
    }))
    near(out.identity.value, PURPLE, 5)
    // The blend behind the hero needs it.
    expect(out.highlight.value).toBe(ruled.highlight.value)
  })

  it('does not call the model when rules settle everything', async () => {
    const ev = colourEvidence([page({ logo: solidLogo(BLUE), button: BLUE })])
    const roles = decideRoles(ev)
    const out = await classifyRoles(ev, roles, async () => {
      throw new Error('no call expected')
    })
    expect(out).toEqual(roles)
  })
})

describe('roles to design fields', () => {
  const merge = (patch: ReturnType<typeof rolesToDesign>) => {
    const d = defaultDesign()
    return {
      ...d,
      brand: {
        ...d.brand,
        light: { ...d.brand.light, ...patch.brand.light },
        ...(patch.brand.logoColours ? { logoColours: patch.brand.logoColours } : {}),
      },
      shape: { ...d.shape, ...patch.shape },
      layout: { ...d.layout, ...patch.layout },
      ...(patch.tune ? { tune: patch.tune } : {}),
    }
  }

  it('maps black buttons to the ink fill and a tinted navy to the second colour', () => {
    const roles = decideRoles(colourEvidence([page({ logo: solidLogo(CORAL), button: NAVY })]))
    const patch = rolesToDesign(roles)
    expect(patch.shape.fill).toBe('ink')
    expect(patch.brand.light.support).toBeTruthy()
    expect(patch.layout.tint).toBe('neutral')
    expect(portalDesign.safeParse(merge(patch)).success).toBe(true)
  })

  it('maps a grey or second-colour button to its exact fill, and a monochrome site to ink links', () => {
    const roles = decideRoles(
      colourEvidence([page({ logo: solidLogo(INK), button: INK, heroPhoto: true })])
    )
    const grey = {
      ...roles,
      action: {
        value: { role: 'neutral' as const, hex: '#f5f5f5' },
        why: 'grey',
        by: 'rule' as const,
      },
    }
    const patch = rolesToDesign(grey)
    expect(patch.tune?.button).toEqual({ fill: '#f5f5f5', ink: '#111111' })
    expect(patch.tune?.link?.colour).toBe(roles.links.value.hex)
    expect(patch.hints.monochrome).toBe(true)
    expect(patch.hints.heroLook).toBe('image')
    expect(portalDesign.safeParse(merge(patch)).success).toBe(true)
  })
})
