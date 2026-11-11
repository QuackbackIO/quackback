// @vitest-environment happy-dom
/**
 * The footer under every portal page: a contentinfo landmark holding only the
 * centred "Powered by Quackback" credit with the duck, in the page's secondary
 * text and saying it opens a new tab. Where the credit is hidden there is no
 * footer.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { PortalFooter } from '../portal-footer'

afterEach(cleanup)

function mount(props: Partial<Parameters<typeof PortalFooter>[0]>) {
  return render(
    <IntlProvider locale="en" messages={{}}>
      <PortalFooter showPoweredBy workspaceSlug="acme" {...props} />
    </IntlProvider>
  )
}

describe('PortalFooter', () => {
  it('is a footer landmark with the credit as its only link', () => {
    mount({})
    const footer = screen.getByRole('contentinfo')
    expect(footer.tagName).toBe('FOOTER')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('centres the credit, with the duck, saying it opens a new tab', () => {
    const { container } = mount({})
    const credit = screen.getByRole('link', { name: 'Powered by Quackback (opens in a new tab)' })
    expect(credit.getAttribute('target')).toBe('_blank')
    expect(credit.getAttribute('rel')).toContain('noopener')
    expect(credit.getAttribute('href')).toContain('utm_campaign=acme')
    expect(credit.className).toContain('text-muted-foreground')
    expect(credit.parentElement!.className).toContain('justify-center')
    expect(container.querySelector('img[src="/logo-64.png"]')).toBeTruthy()
  })

  it('draws the duck from a file its size, fetched once the page nears it', () => {
    const { container } = mount({})
    const duck = container.querySelector('img')!
    expect(duck.getAttribute('loading')).toBe('lazy')
    expect([duck.getAttribute('width'), duck.getAttribute('height')]).toEqual(['14', '14'])
    // The full logo is over half a megabyte; every visitor paid for it at 14px.
    const file = readFileSync(join(import.meta.dirname, '../../../../public/logo-64.png'))
    expect(file.byteLength).toBeLessThan(8 * 1024)
  })

  it('is left out where the workspace may hide the credit', () => {
    mount({ showPoweredBy: false })
    expect(screen.queryByRole('contentinfo')).toBeNull()
  })
})
