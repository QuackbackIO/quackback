/**
 * A brand's type and shapes, read from its HTML and CSS: the rules that match
 * each element apply in cascade order, sizes resolve as a wide screen sees
 * them, and what cannot be read stays unmeasured.
 */
import { describe, expect, it } from 'vitest'
import { measureSite } from '../site-measure'

const PAGE = `<html><body>
  <header><a class="btn btn--primary" href="/signup">Sign up</a></header>
  <h1 class="hero__title text-display">Payments infrastructure</h1>
  <h2 class="section-title">Modular solutions</h2>
  <div class="card card--feature">A card</div>
  <input type="email" class="field">
</body></html>`

describe('measuring a brand from its page', () => {
  it('applies the matching rules in cascade order, utility classes included', () => {
    const m = measureSite(PAGE, [
      `:root { --hero: clamp(2rem, 4vw, 3rem); --brand-radius: 4px }
       h1 { font-size: 2em; font-weight: 700 }
       .text-display { font-size: var(--hero); font-weight: 300; letter-spacing: -0.02em; line-height: 1.15 }
       .section-title { font: 300 2rem/1.1 sohne, sans-serif }
       .btn { border-radius: 999px; min-height: 2.5rem }
       .btn--primary { border-radius: var(--brand-radius) }
       .card { border-radius: 6px; box-shadow: none; border: 1px solid #eee }
       input.field { border-radius: 8px }`,
    ])
    expect(m.headline).toEqual({ size: 48, weight: 300, tracking: -0.02, leading: 1.15 })
    expect(m.heading).toEqual({ size: 32, weight: 300, leading: 1.1 })
    expect(m.button).toEqual({ radius: 4, height: 40 })
    expect(m.card).toEqual({ radius: 6, borderWidth: 1, shadow: false })
    expect(m.field).toEqual({ radius: 8 })
  })

  it('reads a wide, light screen: small-screen and dark rules are left out', () => {
    const m = measureSite(PAGE, [
      `.text-display { font-size: 64px }
       @media (max-width: 600px) { .text-display { font-size: 28px } }
       @media (prefers-color-scheme: dark) { .text-display { font-size: 12px } }
       @media (min-width: 1024px) { .text-display { font-size: 72px } }`,
    ])
    expect(m.headline?.size).toBe(72)
  })

  it('leaves out what it cannot read rather than guess', () => {
    const m = measureSite(PAGE, [
      `.text-display:hover { font-size: 90px }
       [data-theme] h1 { font-size: 90px }
       .btn { border-radius: var(--missing) }`,
    ])
    expect(m.headline).toBeNull()
    expect(m.button).toBeNull()
    expect(m.card).toBeNull()
  })
})
