// @vitest-environment happy-dom
/**
 * End-to-end wiring check for the Chinese catalogs. The key/ICU *parity* tests
 * prove the files are well-formed; this proves they actually LOAD and RENDER
 * through the real client stack: loadMessages' dynamic import resolves the new
 * `zh-cn`/`zh-tw` files (not the English catch-fallback), PortalIntlProvider →
 * useIntlSetup feeds them to react-intl, and the collapsed `other`-only plural
 * formats at runtime. None of that is exercised by the static parity tests.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { FormattedMessage } from 'react-intl'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { loadMessages } from '@/lib/shared/i18n'

describe('Chinese locale runtime wiring', () => {
  it('loadMessages resolves the real zh catalogs, not the English fallback', async () => {
    const [en, zhCn, zhTw] = await Promise.all([
      loadMessages('en'),
      loadMessages('zh-cn'),
      loadMessages('zh-tw'),
    ])
    // A wrong import path would silently degrade to en via the catch-fallback,
    // so assert the value is the translation, distinct from English.
    expect(zhCn['portal.header.nav.roadmap']).toBe('路线图')
    expect(zhTw['portal.header.nav.roadmap']).toBe('產品藍圖')
    expect(zhCn['portal.header.nav.roadmap']).not.toBe(en['portal.header.nav.roadmap'])
  })

  it('renders Chinese synchronously when SSR provides the catalog (no async wait)', async () => {
    const zhCn = await loadMessages('zh-cn')
    render(
      <PortalIntlProvider locale="zh-cn" messages={zhCn}>
        <span data-testid="nav-ssr">
          <FormattedMessage id="portal.header.nav.roadmap" defaultMessage="Roadmap" />
        </span>
      </PortalIntlProvider>
    )
    // No findBy/waitFor: the SSR path must already hold the translation on the
    // very first render (the server has no effects), so the page never flashes
    // English. getByTestId reads that first synchronous render.
    expect(screen.getByTestId('nav-ssr').textContent).toBe('路线图')
  })

  it('renders Simplified Chinese through PortalIntlProvider and sets <html lang>', async () => {
    render(
      <PortalIntlProvider locale="zh-cn">
        <span data-testid="nav">
          <FormattedMessage id="portal.header.nav.roadmap" defaultMessage="Roadmap" />
        </span>
      </PortalIntlProvider>
    )
    const node = await screen.findByTestId('nav')
    // Renders the English defaultMessage first, then swaps once the async
    // catalog load resolves — wait for the Chinese to apply.
    await waitFor(() => expect(node.textContent).toBe('路线图'))
    expect(document.documentElement.lang).toBe('zh-cn')
    expect(document.documentElement.dir).toBe('ltr') // Chinese is LTR
  })

  it('formats the collapsed other-only plural with the count substituted', async () => {
    render(
      <PortalIntlProvider locale="zh-tw">
        <span data-testid="plural">
          <FormattedMessage
            id="widget.postDetail.comments"
            defaultMessage="{count, plural, one {# comment} other {# comments}}"
            values={{ count: 3 }}
          />
        </span>
      </PortalIntlProvider>
    )
    const node = await screen.findByTestId('plural')
    await waitFor(() => expect(node.textContent).toBe('3 則留言'))
    expect(node.textContent).not.toMatch(/comment/i) // English plural did not leak
  })
})
