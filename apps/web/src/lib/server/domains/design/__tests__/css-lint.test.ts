/**
 * A workspace's own CSS styles the portal's parts and nothing past them: what
 * reaches outside styling is refused, and what will break or read poorly is
 * warned about, with the part to use instead of an internal class.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lintDesignCss } from '../css-lint'
import { rewritePartAliases } from '@/lib/shared/design/parts'

const messages = (issues: { message: string }[]) => issues.map((issue) => issue.message)

describe('lintDesignCss', () => {
  it('passes CSS that styles parts with their tokens', () => {
    const report = lintDesignCss(`
      [data-qb-part="post-card"] { --qb-card-padding: 1.25rem; border-width: 2px; }
      [data-qb-part="vote-button"][data-state="voted"] { color: #ffffff; background: #1d4ed8; }
      @font-face { font-family: Brand; src: url(/api/storage/fonts/brand.woff2); }
    `)
    expect(report).toEqual({ errors: [], warnings: [] })
  })

  it.each([
    ['@import url(/api/storage/x.css);', '@import'],
    ['body { background: url(https://example.com/x.png); }', 'url(https://example.com/x.png)'],
    ['body { background: url("data:image/png;base64,AAAA"); }', 'url(data:image/png;base64,AAAA)'],
    ['body { width: expression(alert(1)); }', 'expression()'],
    ['body { behavior: url(/api/storage/x.htc); }', 'behavior'],
    ['body::after { content: "</style>"; }', '"<"'],
  ])('refuses %s', (css, named) => {
    const { errors } = lintDesignCss(css)
    expect(errors.length).toBeGreaterThan(0)
    expect(messages(errors).join(' ')).toContain(named)
  })

  it('refuses CSS that does not parse, with the line', () => {
    const { errors } = lintDesignCss('a { color: red;\n}\n}}} {{')
    expect(errors.length).toBeGreaterThan(0)
    expect(messages(errors)[0]).toMatch(/does not parse/)
  })

  it('warns on an internal class, offering the part to use', () => {
    const { errors, warnings } = lintDesignCss('.portal-nav__item--active { font-weight: 700; }')
    expect(errors).toEqual([])
    expect(warnings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('[data-qb-part="nav-item"][data-state="active"]'),
        line: 1,
        fix: {
          find: '.portal-nav__item--active',
          replace: '[data-qb-part="nav-item"][data-state="active"]',
        },
      }),
    ])
  })

  it('offers the part only for a class that is the whole part', () => {
    const { warnings } = lintDesignCss(
      '.post-card { border-width: 2px; } .post-card__link { color: red; }'
    )
    expect(warnings.map((warning) => warning.fix ?? null)).toEqual([
      { find: '.post-card', replace: '[data-qb-part="post-card"]' },
      null,
    ])
  })

  it('warns on !important, a private token, an unknown part and poor contrast', () => {
    const { errors, warnings } = lintDesignCss(`
      [data-qb-part="header"] { color: #999999 !important; background: #ffffff; }
      :root { --qb-band-tint: 0.5; }
      [data-qb-part="sidebar"] { display: none; }
    `)
    expect(errors).toEqual([])
    const text = messages(warnings).join('\n')
    expect(text).toContain('!important')
    expect(text).toContain('--qb-band-tint is not one of the parts')
    expect(text).toContain('There is no sidebar part')
    expect(text).toMatch(/Text on the header part reads at 2\.\d:1/)
  })
})

describe('rewritePartAliases', () => {
  it('leaves CSS with today’s names as it is', () => {
    const css = '[data-qb-part="post-card"] { color: red }'
    expect(rewritePartAliases(css)).toBe(css)
  })

  it('moves an old name to the new one, and running it again changes nothing', () => {
    const aliases = { card: 'post-card' }
    const css = `[data-qb-part="card"] { color: red } [data-qb-part=card] a { color: blue }
      [data-qb-part="card-title"] { margin: 0 }`
    const once = rewritePartAliases(css, aliases)
    expect(once)
      .toBe(`[data-qb-part="post-card"] { color: red } [data-qb-part=post-card] a { color: blue }
      [data-qb-part="card-title"] { margin: 0 }`)
    expect(rewritePartAliases(once, aliases)).toBe(once)
  })
})

describe('the CSS check in the server bundle', () => {
  // css-tree's module entry reads data files at runtime, which the server
  // bundle does not carry: every request then fails as the design service
  // loads. Its self-contained build has the data inlined.
  it('parses with css-tree’s self-contained build', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'css-lint.ts'), 'utf8')
    expect(source).toMatch(/from 'css-tree\/dist\/csstree\.esm'/)
    expect(source).not.toMatch(/import \* as \w+ from 'css-tree'/)
  })
})
