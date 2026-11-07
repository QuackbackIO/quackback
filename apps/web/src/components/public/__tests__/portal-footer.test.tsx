// @vitest-environment happy-dom
/**
 * The footer under every portal page: a contentinfo landmark holding only the
 * centred "Powered by Quackback" credit with the duck, in the page's secondary
 * text and saying it opens a new tab. Where the credit is hidden there is no
 * footer.
 */
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
    expect(container.querySelector('img[src="/logo.png"]')).toBeTruthy()
  })

  it('is left out where the workspace may hide the credit', () => {
    mount({ showPoweredBy: false })
    expect(screen.queryByRole('contentinfo')).toBeNull()
  })
})
