/**
 * A workspace's theme CSS comes first and its custom CSS second, so custom
 * CSS can override the theme. The portal layout, access gate included, puts
 * both in the document head through portalDesignStyles(); the widget and the
 * portal auth pages render PortalDesignStyle.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PortalDesignStyle, portalDesignStyles } from '../safe-inline-content'

const render = (themeStyles: string, customCss: string) =>
  renderToStaticMarkup(<PortalDesignStyle themeStyles={themeStyles} customCss={customCss} />)

describe('PortalDesignStyle', () => {
  it('writes the theme, then the custom CSS', () => {
    expect(render(':root { --primary: red; }', '.x { color: blue }')).toBe(
      '<style>:root { --primary: red; }</style><style>.x { color: blue }</style>'
    )
  })

  it('leaves out an empty theme or custom CSS', () => {
    expect(render(':root { --a: 1; }', '')).toBe('<style>:root { --a: 1; }</style>')
    expect(render('', '.x { color: blue }')).toBe('<style>.x { color: blue }</style>')
    expect(render('', '')).toBe('')
  })

  it('keeps markup in either one from closing the style element', () => {
    const markup = render('a</style>', 'b</style><script>')
    expect(markup).not.toContain('</style><script>')
    expect(markup.match(/<\/style>/g)).toHaveLength(2)
  })
})

describe('portalDesignStyles', () => {
  it('gives the head the theme, then the custom CSS, leaving out an empty one', () => {
    expect(portalDesignStyles({ themeStyles: ':root { --a: 1; }', customCss: '.x {}' })).toEqual([
      { children: ':root { --a: 1; }' },
      { children: '.x {}' },
    ])
    expect(portalDesignStyles({ themeStyles: '', customCss: '.x {}' })).toEqual([
      { children: '.x {}' },
    ])
  })

  it('keeps markup in either one from closing the style element', () => {
    const [theme, custom] = portalDesignStyles({ themeStyles: 'a</style>', customCss: 'b</style>' })
    expect(theme.children).not.toContain('</style>')
    expect(custom.children).not.toContain('</style>')
  })
})

describe('the places that inject portal CSS', () => {
  const read = (file: string) => readFileSync(join(__dirname, '../../..', file), 'utf8')

  it.each(['routes/widget.tsx', 'components/auth/portal-auth-shell.tsx'])(
    '%s renders PortalDesignStyle instead of its own style tags',
    (file) => {
      const source = read(file)
      expect(source).toContain('<PortalDesignStyle')
      expect(source).not.toContain('escapeInlineStyle(themeStyles)')
      expect(source).not.toContain('escapeInlineStyle(customCss)')
    }
  )

  it('puts the portal layout’s CSS in the head, once, for the gate too', () => {
    expect(read('routes/_portal.tsx')).toContain('portalDesignStyles(')
    expect(read('routes/_portal.tsx')).not.toContain('<PortalDesignStyle')
    expect(read('components/portal/portal-access-gate.tsx')).not.toContain('<PortalDesignStyle')
  })
})
