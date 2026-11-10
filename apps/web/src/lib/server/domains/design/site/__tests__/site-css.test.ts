import { describe, expect, it } from 'vitest'
import { cleanFamilyName, colourHex, fontFactOf, readSiteCss } from '../site-css'

describe('cleanFamilyName', () => {
  it.each([
    ['"Inter"', 'Inter'],
    ["'Source Serif 4'", 'Source Serif 4'],
    ['__Inter_d65c78', 'Inter'],
    ['__Source_Serif_4_a1b2c3', 'Source Serif 4'],
    ['Brandface-1bbd4a4c7a2fb472', 'Brandface'],
    ['Roboto', 'Roboto'],
    ['Nimbus-Display', 'Nimbus-Display'],
  ])('%s is %s', (raw, clean) => {
    expect(cleanFamilyName(raw)).toBe(clean)
  })

  it('drops generated fallback and placeholder families', () => {
    expect(cleanFamilyName('__Inter_Fallback_d65c78')).toBeNull()
    expect(cleanFamilyName('"Brandface Fallback"')).toBeNull()
    expect(cleanFamilyName('Brandface Placeholder')).toBeNull()
    expect(cleanFamilyName('""')).toBeNull()
  })
})

describe('fontFactOf', () => {
  it('names the first real family and the kind the stack falls back to', () => {
    expect(fontFactOf('"Inter", Helvetica, Arial, sans-serif', 'body')).toEqual({
      family: 'Inter',
      stack: ['Inter', 'Helvetica', 'Arial', 'sans-serif'],
      generic: 'sans',
      from: 'body',
    })
    expect(fontFactOf('Brandface, Georgia', 'h1')?.generic).toBe('serif')
    expect(fontFactOf('Codeface, Menlo', 'code')?.generic).toBe('mono')
    expect(fontFactOf('Brandface', 'h1')?.generic).toBeNull()
  })

  it('reads a system stack as the system font', () => {
    expect(
      fontFactOf('-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 'body')
    ).toMatchObject({ family: 'system-ui', generic: 'sans' })
  })

  it('names a stack of a generic keyword alone by its keyword', () => {
    expect(fontFactOf('serif', 'body')).toMatchObject({ family: 'serif', generic: 'serif' })
    expect(fontFactOf('inherit', 'body')).toBeNull()
  })

  it('drops next/font fallback families from the stack', () => {
    expect(fontFactOf("'__Inter_d65c78', '__Inter_Fallback_d65c78'", 'body')?.stack).toEqual([
      'Inter',
    ])
  })
})

describe('colourHex', () => {
  it.each([
    ['#F60', '#ff6600'],
    ['#1A2B3C', '#1a2b3c'],
    ['rgb(255, 102, 0)', '#ff6600'],
    ['rgb(255 102 0)', '#ff6600'],
    ['rgba(255, 102, 0, 1)', '#ff6600'],
    ['rgb(255 102 0 / 100%)', '#ff6600'],
    ['hsl(24, 100%, 50%)', '#ff6600'],
    ['24 100% 50%', '#ff6600'],
  ])('%s is %s', (value, hex) => {
    expect(colourHex(value)).toBe(hex)
  })

  it('refuses translucent and named colours', () => {
    expect(colourHex('rgba(255, 102, 0, 0.5)')).toBeNull()
    expect(colourHex('transparent')).toBeNull()
    expect(colourHex('red')).toBeNull()
  })
})

describe('readSiteCss fonts', () => {
  it('takes headings from h1 and body text from body', () => {
    const css = `
      html { font-family: Arial, sans-serif }
      body { font-family: "Inter", sans-serif }
      h1, h2 { font-family: "Source Serif 4", Georgia, serif }
    `
    const out = readSiteCss([css])
    expect(out.heading).toMatchObject({ family: 'Source Serif 4', generic: 'serif', from: 'h1' })
    expect(out.body).toMatchObject({ family: 'Inter', generic: 'sans', from: 'body' })
  })

  it('falls back to h2, then to the body font a heading inherits', () => {
    expect(readSiteCss(['body{font-family:Inter} h2{font-family:Roboto}']).heading?.family).toBe(
      'Roboto'
    )
    expect(readSiteCss(['body{font-family:Inter}']).heading).toMatchObject({
      family: 'Inter',
      from: 'body',
    })
  })

  it('ignores h2 when h1 is styled', () => {
    expect(readSiteCss(['h1{font-family:Lora} h2{font-family:Roboto}']).heading?.family).toBe(
      'Lora'
    )
  })

  it('lets a later rule beat an earlier one at the same level, across sheets', () => {
    const out = readSiteCss(['body{font-family:Roboto}', 'body{font-family:Inter}'])
    expect(out.body?.family).toBe('Inter')
  })

  it('reads the font shorthand', () => {
    const out = readSiteCss(['h1 { font: 700 clamp(2rem, 5vw, 4rem)/1.1 "Lora", serif }'])
    expect(out.heading).toMatchObject({ family: 'Lora', generic: 'serif' })
    expect(readSiteCss(['body { font: 16px/1.5 Inter, sans-serif }']).body?.family).toBe('Inter')
  })

  it('resolves var() through custom properties, with fallbacks', () => {
    const css = `
      :root { --font-sans: var(--font-inter), system-ui, sans-serif }
      .__variable_abc123 { --font-inter: '__Inter_d65c78', '__Inter_Fallback_d65c78' }
      body { font-family: var(--font-sans) }
      h1 { font-family: var(--font-display, "Lora", serif) }
    `
    const out = readSiteCss([css])
    expect(out.body).toMatchObject({
      family: 'Inter',
      stack: ['Inter', 'system-ui', 'sans-serif'],
      generic: 'sans',
      from: '--font-sans',
    })
    expect(out.heading).toMatchObject({ family: 'Lora', generic: 'serif' })
  })

  it('skips a declaration whose var() cannot be resolved', () => {
    const out = readSiteCss(['body{font-family:Roboto} body{font-family:var(--missing)}'])
    expect(out.body?.family).toBe('Roboto')
  })

  it('resolves utility classes the h1 and body carry', () => {
    const css = `
      :root { --font-display: "Brandface-1bbd4a4c7a2fb472", Georgia, serif; --font-body: Inter, sans-serif }
      .font-display { font-family: var(--font-display) }
      .font-body { font-family: var(--font-body) }
      .font-mono { font-family: Menlo, monospace }
      h1 { font-family: Roboto }
    `
    const out = readSiteCss([css], {
      headingClasses: ['font-display', 'text-4xl'],
      bodyClasses: ['font-body'],
    })
    expect(out.heading).toMatchObject({
      family: 'Brandface',
      generic: 'serif',
      from: '--font-display',
    })
    expect(out.body).toMatchObject({ family: 'Inter', from: '--font-body' })
  })

  it('collects @font-face families, cleaned and deduped', () => {
    const css = `
      @font-face { font-family: "Brandface"; src: url(a.woff2) }
      @font-face { font-family: 'Brandface'; font-weight: 700; src: url(b.woff2) }
      @font-face { font-family: __Inter_d65c78; src: url(c.woff2) }
      @font-face { font-family: __Inter_Fallback_d65c78; src: local(Arial) }
    `
    expect(readSiteCss([css]).faces).toEqual(['Brandface', 'Inter'])
  })

  it('survives broken CSS and empty input', () => {
    expect(
      readSiteCss(['body { font-family: Inter; } h1 { font-family: ', '}}}{{{'])
    ).toMatchObject({
      body: { family: 'Inter' },
    })
    expect(readSiteCss([])).toEqual({ heading: null, body: null, faces: [], colours: [] })
  })

  it('caps how much CSS it reads', () => {
    const filler = `.x{color:red}`.repeat(120_000)
    const out = readSiteCss([filler, 'body{font-family:Inter}'])
    expect(out.body).toBeNull()
  })
})

describe('readSiteCss colours', () => {
  it('weighs brand and primary properties over accents and buttons', () => {
    const css = `
      :root {
        --brand-orange: #FF6600;
        --accent: var(--teal);
        --teal: rgb(0, 128, 128);
        --cta-bg: hsl(270, 60%, 50%);
        --primary: 222 80% 40%;
        --text: #222;
      }
      .btn-primary { background-color: #0055aa }
      button.cta { background: var(--teal) url(x.png) no-repeat }
    `
    const { colours } = readSiteCss([css])
    expect(colours.map((c) => [c.from, c.weight])).toEqual([
      ['--brand-orange', 3],
      ['--primary', 3],
      ['--accent', 2],
      ['--cta-bg', 2],
      ['button background', 2],
    ])
    expect(colours[0].hex).toBe('#ff6600')
    expect(colours[2].hex).toBe('#008080')
  })

  it('drops neutrals and dedupes by hex, keeping the strongest', () => {
    const css = `
      :root { --primary-foreground: #ffffff; --brand-ink: #111111; --accent: #ff6600; --brand: #ff6600 }
      .btn { background: #f5f5f5 }
    `
    expect(readSiteCss([css]).colours).toEqual([{ hex: '#ff6600', from: '--brand', weight: 3 }])
  })

  it('takes no colour from the rules of a consent banner', () => {
    const css = `
      :root { --brand: #ff6600 }
      #onetrust-consent-sdk { --ot-accent: #00ccbc; --primary: #00ccbc }
      .optanon-alert-box-wrapper .optanon-button-allow .optanon-alert-box-button { background-color: #00ccbc }
      .cookie-banner button { background: #7a1fa2 }
    `
    expect(readSiteCss([css]).colours).toEqual([{ hex: '#ff6600', from: '--brand', weight: 3 }])
  })

  it('still reads a brand selector listed beside a consent one', () => {
    const css = '.cookie-banner button, .hero .btn { background: #7a1fa2 }'
    expect(readSiteCss([css]).colours).toEqual([
      { hex: '#7a1fa2', from: 'button background', weight: 2 },
    ])
  })

  it('caps the list at 12', () => {
    const vars = Array.from({ length: 20 }, (_, i) => `--accent-${i}: hsl(${i * 15}, 80%, 50%);`)
    expect(readSiteCss([`:root{${vars.join('')}}`]).colours).toHaveLength(12)
  })
})
