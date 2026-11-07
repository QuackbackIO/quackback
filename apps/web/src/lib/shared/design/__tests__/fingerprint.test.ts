/**
 * The fingerprint score is the rig's (score.py), ported: on real site and
 * portal fingerprints from the rig it gives the numbers the Python scorer
 * gave (computed once with score.py and pinned here), and a target that
 * leaves a property out is not scored on it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hexToRgb, scoreFingerprint, toOklab, type Fingerprint } from '../fingerprint'

const fixture = (name: string): Fingerprint =>
  JSON.parse(
    readFileSync(path.join(__dirname, 'fixtures', 'fingerprints', `${name}.json`), 'utf8')
  ) as Fingerprint

/** score.py's totals before rounding, for each brand's site against its g4 portal. */
const PYTHON: Record<string, number> = {
  paylane: 64.32615984668885,
  fernway: 55.81937345103394,
  hemla: 57.01137431629769,
  coralbank: 65.43414214021014,
  chatterly: 54.36997955423952,
  notewell: 76.92693155089673,
}

describe('scoreFingerprint', () => {
  for (const [brand, expected] of Object.entries(PYTHON))
    it(`matches the Python scorer on ${brand}`, () => {
      const { score } = scoreFingerprint(fixture(`${brand}-site`), fixture(`${brand}-portal`))
      expect(score).toBeCloseTo(expected, 9)
    })

  it('scores a fingerprint against itself as 100', () => {
    const site = fixture('paylane-site')
    expect(scoreFingerprint(site, site).score).toBeCloseTo(100, 9)
  })

  it('names the gaps worst first, as the detail rows do', () => {
    const { gaps } = scoreFingerprint(fixture('fernway-site'), fixture('fernway-portal'))
    expect(gaps.length).toBeGreaterThan(5)
    expect(gaps[0]!.match).toBe(0)
    expect(gaps.map((g) => `${g.role}.${g.prop}`)).toContain('button.radius')
    for (let i = 1; i < gaps.length; i++)
      expect(gaps[i]!.match).toBeGreaterThanOrEqual(gaps[i - 1]!.match)
  })

  it('leaves out what the target does not know', () => {
    const target: Fingerprint = {
      page: 'rgb(255, 255, 255)',
      headline: { size: 48, weight: 300 },
      button: { bg: 'rgb(99, 91, 255)', radius: 4 },
    }
    const actual: Fingerprint = {
      page: 'rgb(255, 255, 255)',
      headline: { family: 'Inter', size: 48, weight: 300, transform: 'uppercase', color: 'red' },
      button: { bg: 'rgb(99, 91, 255)', radius: 5, shadow: true, height: 20 },
      card: { radius: 40 },
    }
    expect(scoreFingerprint(target, actual).score).toBeCloseTo(100, 9)
  })

  it('counts fully round apart from any other corner', () => {
    const t: Fingerprint = { button: { radius: 999 } }
    expect(scoreFingerprint(t, { button: { radius: 6 } }).score).toBeCloseTo(20, 9)
    expect(
      scoreFingerprint({ button: { radius: 6 } }, { button: { radius: 14 } }).score
    ).toBeCloseTo(50, 9)
  })

  it('gives nothing to compare as null', () => {
    expect(scoreFingerprint({}, { page: 'rgb(0, 0, 0)' }).score).toBeNull()
  })
})

describe('colours', () => {
  it('reads rgb, oklch and oklab alike, and drops the transparent', () => {
    const white = toOklab('rgb(255, 255, 255)')!
    expect(white[0]).toBeCloseTo(1, 3)
    expect(toOklab('oklch(1 0 0)')![0]).toBeCloseTo(1, 6)
    expect(toOklab('oklab(0.5 -0.1 0.02 / 0.4)')).toEqual([0.5, -0.1, 0.02])
    expect(toOklab('rgba(0, 0, 0, 0)')).toBeNull()
    expect(hexToRgb('#635BFF')).toBe('rgb(99, 91, 255)')
    expect(hexToRgb('blue')).toBeNull()
  })
})
