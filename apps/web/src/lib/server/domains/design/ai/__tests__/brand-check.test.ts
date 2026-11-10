/**
 * The verified loop's server steps: the critic's and the revision's few-shot
 * examples are valid answers to their schemas, come from fictional brands
 * only and stay within the grammar the provider compiles; the critic's
 * prompt carries the art director's rubric and, without a picture, the
 * drawn portal in words; a revision keeps only allowed fields with values
 * from their options and the measured palette; scoring combines the
 * measured score with the critic's, or stands on the measured one when the
 * critic fails; a revision is applied to the draft and returned unsaved;
 * and what a match measured maps to a fingerprint by the rig's roles.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CRITIC_DIMENSIONS, combinedScore, runCheckLoop } from '@/lib/shared/design/brand-check'
import { scoreFingerprint, type Fingerprint } from '@/lib/shared/design/fingerprint'
import { defaultDesign } from '@/lib/shared/design/schema'
import type { FamilyCaller, FamilyRequest } from '../brand-brief'
import {
  CRITIC_EXAMPLES,
  criticPrompt,
  criticSchema,
  scoreOfCritic,
  type CriticAnswer,
} from '../brand-critic'
import {
  REVISABLE,
  REVISE_EXAMPLES,
  answerChanges,
  parseRevisionValue,
  proposeRevision,
  revisePrompt,
  reviseSchema,
} from '../brand-revise'
import { reviseCheck, scoreCheck } from '../brand-check-request'
import { targetFingerprint } from '../brand-target'
import { RIG_BRAND_HASHES, wordsHashedIn } from './rig-brands'
import type { MeasuredDesign } from '../../extract/measured-design'
import type { ColourRoles } from '../../extract/roles'

const fixture = (name: string): Fingerprint =>
  JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        '../../../../../shared/design/__tests__/fixtures/fingerprints',
        `${name}.json`
      ),
      'utf8'
    )
  ) as Fingerprint

/** The rig's fictional goal brands: never in an example either. */
const GOAL_BRANDS = /harbor|voltline|northwind|petalpost/i
/** Whether an example names a brand the rig measures, real (hashed) or fictional. */
const namesRigBrand = (example: unknown) => {
  const text = JSON.stringify(example)
  return wordsHashedIn(text, RIG_BRAND_HASHES).length > 0 || GOAL_BRANDS.test(text)
}

const properties = (node: unknown): number =>
  !node || typeof node !== 'object'
    ? 0
    : Object.entries(node).reduce(
        (n, [key, value]) =>
          n + (key === 'properties' ? Object.keys(value as object).length : 0) + properties(value),
        0
      )

const CRITIC: CriticAnswer = CRITIC_EXAMPLES[0]!.answer

describe('the critic', () => {
  it('has examples that are valid answers, from fictional brands only', () => {
    for (const example of CRITIC_EXAMPLES) {
      expect(criticSchema.parse(example.answer)).toEqual(example.answer)
      expect(namesRigBrand(example)).toBe(false)
    }
  })

  it('scores every dimension of the rubric, flat', () => {
    const shape = criticSchema.shape
    for (const d of CRITIC_DIMENSIONS) {
      expect(shape[d]).toBeDefined()
      expect(shape[`${d}_evidence`]).toBeDefined()
    }
    expect(properties(z.toJSONSchema(criticSchema))).toBeLessThanOrEqual(20)
  })

  it('carries the rubric, and the portal in words when no picture was taken', () => {
    const drawn = fixture('fernway-portal')
    const withPicture = criticPrompt({ shots: 2, picture: true, drawn, brand: 'Acme' })
    expect(withPicture).toContain('art director')
    expect(withPicture).toContain('product surface')
    expect(withPicture).toContain('images 1 to 2')
    expect(withPicture).toContain('Image 3 is the portal')
    const without = criticPrompt({ shots: 1, picture: false, drawn, brand: null })
    expect(without).toContain('No picture of the portal could be taken')
    expect(without).toContain('main button fill rgb(0, 129, 186)')
  })

  it('weighs its dimensions into one score', () => {
    expect(scoreOfCritic(CRITIC)).toBeCloseTo((6 * 2 + 8 * 1.5 + 4 + 4 + 9 * 0.5 + 7) / 7, 9)
  })
})

describe('the revision', () => {
  it('has examples that are valid answers, from fictional brands only, in their options', () => {
    for (const example of REVISE_EXAMPLES) {
      expect(reviseSchema.parse(example.answer)).toEqual(example.answer)
      expect(namesRigBrand(example)).toBe(false)
      for (const c of answerChanges(example.answer))
        expect(parseRevisionValue(c.field, c.value, ['#111111', '#b0123a'])).not.toBeNull()
    }
    expect(properties(z.toJSONSchema(reviseSchema))).toBeLessThanOrEqual(20)
  })

  it('reads values by their field: options, clamped numbers, the measured palette', () => {
    expect(parseRevisionValue('shape.buttons', 'pill', [])).toBe('pill')
    expect(parseRevisionValue('shape.buttons', 'oval', [])).toBeNull()
    expect(parseRevisionValue('brand.fonts.headingWeight', '300', [])).toBe(300)
    expect(parseRevisionValue('tune.headline.size', '480', [])).toBe(200)
    expect(parseRevisionValue('tune.button.radius', 'fully round', [])).toBe(999)
    expect(parseRevisionValue('tune.button.fill', '#ABCDEF', ['#abcdef'])).toBe('#abcdef')
    expect(parseRevisionValue('tune.button.fill', '#123456', ['#abcdef'])).toBeNull()
    expect(parseRevisionValue('brand.name', 'x', [])).toBeNull()
  })

  it('tells the weakest dimensions and the gaps by the fields that move them', () => {
    const { gaps } = scoreFingerprint(
      { headline: { weight: 300 }, button: { radius: 999 } },
      { headline: { weight: 700 }, button: { radius: 4 } }
    )
    const prompt = revisePrompt({
      critic: CRITIC,
      gaps,
      fields: [
        { path: 'tune.headline.weight', now: 700 },
        { path: 'tune.button.radius', now: 4 },
      ],
      palette: [],
    })
    expect(prompt).toContain('Weakest: type 4')
    expect(prompt).toContain(
      'headline.weight measured 300, drawn 700 (fields tune.headline.weight)'
    )
    expect(prompt).toContain(
      'button.radius measured fully round, drawn 4 (fields tune.button.radius)'
    )
    expect(prompt).toContain('tune.button.radius: now 4; change to a number from 0 to 999')
    expect(prompt.slice(prompt.indexOf('Now this brand'))).not.toContain(
      'brand.fonts.headingWeight'
    )
  })

  it('keeps only allowed fields with readable, new values', async () => {
    let asked: FamilyRequest<unknown> | null = null
    const call = (async (request: FamilyRequest<unknown>) => {
      asked = request
      return {
        evidence: 'too heavy',
        change1_field: 'tune.headline.weight',
        change1_value: '300',
        change1_why: 'light',
        change2_field: 'tune.button.radius',
        change2_value: '4',
        change2_why: 'already',
        change3_field: 'tune.button.fill',
        change3_value: '#ff0000',
        change3_why: 'invented',
      }
    }) as FamilyCaller
    const revision = await proposeRevision(
      {
        critic: CRITIC,
        gaps: [],
        fields: [
          { path: 'tune.headline.weight', now: 700 },
          { path: 'tune.button.radius', now: 4 },
          { path: 'tune.button.fill', now: '#00ff00' },
        ],
        palette: ['#00ff00'],
      },
      call
    )
    expect(revision.changes).toEqual([{ path: 'tune.headline.weight', value: 300, why: 'light' }])
    // The schema offers only the fields the match set.
    const offered = z.toJSONSchema(asked!.schema) as unknown as {
      properties: { change1_field: { enum: string[] } }
    }
    expect(offered.properties.change1_field.enum).toEqual([
      'tune.headline.weight',
      'tune.button.radius',
      'tune.button.fill',
      'none',
    ])
  })

  it('asks once more when an answer does not come back', async () => {
    let calls = 0
    const call = (async () => {
      calls++
      if (calls === 1) throw new Error('missing structured result')
      return { ...REVISE_EXAMPLES[1]!.answer }
    }) as unknown as FamilyCaller
    const revision = await proposeRevision(
      {
        critic: CRITIC,
        gaps: [],
        fields: [
          { path: 'tune.button.fill', now: '#b0123a' },
          { path: 'shape.fill', now: 'accent' },
        ],
        palette: ['#111111', '#b0123a'],
      },
      call
    )
    expect(calls).toBe(2)
    expect(revision.changes.map((c) => c.path)).toEqual(['tune.button.fill', 'shape.fill'])
  })

  it('asks nothing when the match set no field a revision may change', async () => {
    const call = vi.fn()
    const revision = await proposeRevision(
      { critic: CRITIC, gaps: [], fields: [], palette: [] },
      call as unknown as FamilyCaller
    )
    expect(revision.changes).toEqual([])
    expect(call).not.toHaveBeenCalled()
  })

  it('offers only fields the design has', () => {
    for (const p of Object.keys(REVISABLE)) expect(p).toMatch(/^(tune|brand|shape|layout)\./)
  })
})

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

describe('scoreCheck', () => {
  it('combines the measured score and the critic’s', async () => {
    const family = vi.fn(async () => CRITIC) as unknown as FamilyCaller
    const target = fixture('paylane-site')
    const actual = fixture('paylane-portal')
    const scored = await scoreCheck(
      { op: 'score', round: 0, target, actual, picture: JPEG, shots: [JPEG] },
      { family }
    )
    expect(scored.measured).toBeCloseTo(64.32615984668885, 9)
    expect(scored.critic).toBeCloseTo(scoreOfCritic(CRITIC), 9)
    expect(scored.combined).toBeCloseTo((scored.measured! / 10 + scored.critic!) / 2, 9)
    expect(scored.gaps.length).toBeGreaterThan(0)
    const request = (family as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as FamilyRequest<unknown>
    expect(request.family).toBe('critic')
    expect(request.images).toHaveLength(2)
  })

  it('stands on the measured score when the critic fails', async () => {
    const family = (async () => {
      throw new Error('no answer')
    }) as FamilyCaller
    const scored = await scoreCheck(
      {
        op: 'score',
        round: 1,
        target: fixture('fernway-site'),
        actual: fixture('fernway-portal'),
        shots: [JPEG],
      },
      { family }
    )
    expect(scored.critic).toBeNull()
    expect(scored.answer).toBeNull()
    expect(scored.combined).toBeCloseTo(scored.measured! / 10, 9)
  })
})

describe('reviseCheck', () => {
  const allows = async () => ({
    blockTypes: [],
    links: new Set<string>(),
    checkCss: () => 'no CSS',
    files: new Set<string>(),
  })

  it('applies the revision to the draft and returns it unsaved', async () => {
    const family = (async () => ({
      evidence: 'corners',
      change1_field: 'tune.button.radius',
      change1_value: '999',
      change1_why: 'fully round on the site',
      change2_field: 'none',
      change2_value: '',
      change2_why: '',
      change3_field: 'none',
      change3_value: '',
      change3_why: '',
    })) as unknown as FamilyCaller
    const design = defaultDesign()
    const revised = await reviseCheck(
      {
        op: 'revise',
        round: 1,
        target: { button: { radius: 999 } },
        actual: { button: { radius: 4 } },
        critic: CRITIC,
        paths: ['tune.button.radius', 'brand.logo.name'],
        palette: [],
      },
      { family, draft: async () => design, allows }
    )
    expect(revised.changes).toEqual([
      { path: 'tune.button.radius', value: 999, why: 'fully round on the site' },
    ])
    expect(revised.design?.tune?.button?.radius).toBe(999)
    // The draft read is not changed in place.
    expect(design.tune?.button?.radius).toBeUndefined()
  })

  // Live, Hemla (11-02): a revision swapped the second colour from yellow to blue and the
  // hero went light blue. The colour roles and the hero come from measurement and rules,
  // which a critic's taste must not undo; a revision acts only where a measured gap points.
  it('never offers or applies the brand colours or the hero, and offers only fields a gap points to', async () => {
    const offered: string[][] = []
    const family = (async (request: FamilyRequest<unknown>) => {
      const schema = request.schema as unknown as z.ZodObject<Record<string, z.ZodTypeAny>>
      offered.push([...(schema.shape.change1_field as unknown as { options: string[] }).options])
      return {
        evidence: 'swap',
        change1_field: 'brand.light.support',
        change1_value: '#0058a3',
        change1_why: 'blue as the second colour',
        change2_field: 'layout.hero',
        change2_value: 'support',
        change2_why: 'a bolder hero',
        change3_field: 'tune.headline.weight',
        change3_value: '700',
        change3_why: 'headline measured 700',
      }
    }) as unknown as FamilyCaller
    const revised = await reviseCheck(
      {
        op: 'revise',
        round: 1,
        target: { headline: { size: 24, weight: 700 } },
        actual: { headline: { size: 24, weight: 400 } },
        critic: CRITIC,
        paths: [
          'brand.light.accent',
          'brand.light.support',
          'layout.hero',
          'layout.heroShape',
          'layout.heroArt',
          'layout.tint',
          'layout.density',
          'tune.headline.weight',
          'tune.headline.size',
        ],
        palette: ['#0058a3', '#ffdb00'],
      },
      { family, draft: async () => defaultDesign(), allows }
    )
    expect(offered[0]!.filter((f) => f !== 'none')).toEqual(['tune.headline.weight'])
    expect(revised.changes.map((c) => c.path)).toEqual(['tune.headline.weight'])
    for (const locked of [
      'brand.light.accent',
      'brand.light.support',
      'layout.hero',
      'layout.heroShape',
      'layout.heroArt',
      'layout.tint',
    ])
      expect(REVISABLE).not.toHaveProperty([locked])
  })

  it('proposes nothing, without asking, when no measured gap points anywhere', async () => {
    const family = vi.fn()
    const revised = await reviseCheck(
      {
        op: 'revise',
        round: 1,
        target: { headline: { weight: 700 } },
        actual: { headline: { weight: 700 } },
        critic: CRITIC,
        paths: ['tune.headline.weight', 'layout.density'],
        palette: [],
      },
      { family: family as unknown as FamilyCaller, draft: async () => defaultDesign(), allows }
    )
    expect(family).not.toHaveBeenCalled()
    expect(revised).toMatchObject({ changes: [], design: null })
  })

  it('gives no design when nothing applies', async () => {
    const none = { field: 'none', value: '', why: '' }
    const family = (async () => ({
      evidence: 'fine',
      ...Object.fromEntries(
        [1, 2, 3].flatMap((n) => Object.entries(none).map(([k, v]) => [`change${n}_${k}`, v]))
      ),
    })) as unknown as FamilyCaller
    const revised = await reviseCheck(
      {
        op: 'revise',
        round: 1,
        target: {},
        actual: {},
        critic: null,
        paths: ['tune.button.radius'],
        palette: [],
      },
      { family, draft: async () => defaultDesign(), allows }
    )
    expect(revised).toMatchObject({ changes: [], design: null })
  })
})

describe('targetFingerprint', () => {
  it('maps what was measured to the rig’s roles, and leaves out what was not', () => {
    const measured: MeasuredDesign = {
      fields: { textCase: 'sentence' },
      tune: {
        headline: { size: 48, weight: 300, tracking: -0.02 },
        button: { radius: 4, height: 40 },
        card: { radius: 6, border: 0, shadow: 'none' },
      },
      why: {},
    }
    const roles = {
      action: { value: { role: 'accent', hex: '#635bff' } },
      page: '#ffffff',
    } as unknown as ColourRoles
    expect(targetFingerprint({ measured, roles, headlineInk: [6, 27, 49] })).toEqual({
      page: 'rgb(255, 255, 255)',
      headline: {
        size: 48,
        weight: 300,
        tracking: -0.02,
        transform: 'none',
        color: 'rgb(6, 27, 49)',
      },
      button: { bg: 'rgb(99, 91, 255)', radius: 4, height: 40 },
      card: { radius: 6, borderWidth: 0, shadow: false },
    })
    const lime = { ...roles, page: '#9ee76e' } as ColourRoles
    expect(targetFingerprint({ measured, roles: lime }).page).toBeNull()
    expect(targetFingerprint({ measured: null, roles: null })).toEqual({
      page: null,
      headline: null,
      button: null,
      card: null,
    })
  })
})

/**
 * The check scores against the site, not the pipeline's own say-so: the
 * target is what was measured from the screenshots, as the rig's roles, so
 * when the measuring reads the site right, the target is the site's own
 * rendered truth and a revision towards it is kept.
 */
describe('the check scores against the site', () => {
  // What the match measured from Paylane's clean capture (X0 dpr1, after the 11-02 fixes):
  // a 47px headline at 300, 4px corners, the 40px header button, Paylane's violet.
  const measured: MeasuredDesign = {
    fields: { textCase: 'sentence' },
    tune: { headline: { size: 47, weight: 300 }, button: { radius: 4, height: 41 } },
    why: {},
  }
  const roles = {
    action: { value: { role: 'accent', hex: '#533afb' } },
    page: '#ffffff',
  } as unknown as ColourRoles
  const target = targetFingerprint({ measured, roles })

  it('is the site’s rendered truth by the rig’s roles, as far as it was measured', () => {
    // The site's fingerprint scored against the target: what was measured agrees with the site.
    expect(scoreFingerprint(target, fixture('paylane-site')).score).toBeGreaterThan(97)
  })

  it('keeps a revision that moves the drawn headline towards the site’s real weight', async () => {
    // The portal as drawn with the old read (Inter Tight at 500), then revised to 300.
    const portal = fixture('paylane-portal')
    const drawn = (weight: number): Fingerprint => ({
      ...portal,
      headline: { ...portal.headline!, weight },
    })
    let shown = 500
    const report = await runCheckLoop(shown, {
      read: async () => ({ fingerprint: drawn(shown), picture: null }),
      measure: (reading) => scoreFingerprint(target, reading.fingerprint).score,
      score: async (reading) => {
        const m = scoreFingerprint(target, reading.fingerprint).score
        return { measured: m, critic: 7, combined: combinedScore(m, 7) }
      },
      revise: async (_best, round) =>
        round === 1
          ? { changes: [{ path: 'tune.headline.weight', value: 300 }], design: 300 }
          : null,
      apply: async (weight) => {
        shown = weight
      },
    })
    expect(report.rounds[1]).toMatchObject({ kept: true })
    expect(report.best!.measured!).toBeGreaterThan(report.first!.measured!)
    // And the kept weight is the site's own.
    expect(fixture('paylane-site').headline!.weight).toBe(shown)
  })
})
