/**
 * PortalDesignStyle writes a workspace's theme CSS and then its custom CSS,
 * so custom CSS can override the theme. The portal, the widget, the portal
 * auth pages and the access gate all render it, and the markup is exactly
 * what each of them wrote by hand before.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PortalDesignStyle } from '../safe-inline-content'

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

describe('the places that inject portal CSS', () => {
  const files = [
    'routes/_portal.tsx',
    'routes/widget.tsx',
    'components/auth/portal-auth-shell.tsx',
    'components/portal/portal-access-gate.tsx',
  ]

  it.each(files)('%s renders PortalDesignStyle instead of its own style tags', (file) => {
    const source = readFileSync(join(__dirname, '../../..', file), 'utf8')
    expect(source).toContain('<PortalDesignStyle')
    expect(source).not.toContain('escapeInlineStyle(themeStyles)')
    expect(source).not.toContain('escapeInlineStyle(customCss)')
  })
})
