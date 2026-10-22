import { afterEach, describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { render } from '@react-email/components'
import { EmailBrandingProvider, resolveEmailBranding, setEmailBrandingResolver } from '../branding'
import { ChangelogPublishedEmail } from '../templates/changelog-published'

const SQUARE_LOGO = 'https://example.com/api/storage/logos/square.png?email=1'
const WORDMARK = 'https://example.com/api/storage/header-logos/wordmark.png?email=1'

const email = () =>
  ChangelogPublishedEmail({
    changelogTitle: 'Release',
    changelogUrl: 'https://example.com/changelog/1',
    contentPreview: 'Preview',
    organizationName: 'Acme',
    unsubscribeUrl: 'https://example.com/unsubscribe?token=t',
    logoUrl: SQUARE_LOGO,
  })

describe('email header branding', () => {
  afterEach(() => setEmailBrandingResolver(async () => ({ wordmarkUrl: null })))

  it('shows the square logo when no wordmark is set', async () => {
    const html = await render(email())
    expect(html).toContain(SQUARE_LOGO)
    expect(html).not.toContain(WORDMARK)
  })

  it('shows the wordmark at a fixed height and natural width when one is set', async () => {
    const html = await render(
      createElement(EmailBrandingProvider, { value: { wordmarkUrl: WORDMARK }, children: email() })
    )
    expect(html).toContain(WORDMARK)
    expect(html).not.toContain(SQUARE_LOGO)
    expect(html).toContain('alt="Acme"')
    expect(html).toMatch(/height:40px;width:auto;max-width:100%/)
  })

  it('falls back to the square logo when the branding resolver fails', async () => {
    setEmailBrandingResolver(async () => {
      throw new Error('settings unavailable')
    })
    expect(await resolveEmailBranding()).toEqual({ wordmarkUrl: null })
  })

  it('returns what the installed resolver reports', async () => {
    setEmailBrandingResolver(async () => ({ wordmarkUrl: WORDMARK }))
    expect(await resolveEmailBranding()).toEqual({ wordmarkUrl: WORDMARK })
  })
})
