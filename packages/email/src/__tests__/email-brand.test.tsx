import { describe, it, expect } from 'vitest'
import { render } from '@react-email/components'
import { createElement } from 'react'
import { MagicLinkEmail } from '../templates/magic-link'
import { NewCommentEmail } from '../templates/new-comment'
import { EmailBrandProvider, DEFAULT_EMAIL_BRAND } from '../brand'
import { renderSignInEmailSample } from '../index'

const GREEN = { accent: '#0c862c', accentText: '#ffffff', link: '#0c862c' }

const branded = (brand: typeof GREEN | undefined, element: React.ReactElement) =>
  render(createElement(EmailBrandProvider, { value: brand, children: element }))

describe('email brand', () => {
  it('fills the sign-in button with the brand colour and its readable text', async () => {
    const html = await branded(
      GREEN,
      <MagicLinkEmail signInUrl="https://acme.example/v" code="123456" workspaceName="Acme" />
    )
    expect(html).toMatch(/background-color:#0c862c[^"]*color:#ffffff/)
    expect(html).not.toContain('#FFD43B')
  })

  it('keeps Quackback gold when no brand is given', async () => {
    const html = await branded(
      undefined,
      <MagicLinkEmail signInUrl="https://acme.example/v" code="123456" />
    )
    expect(html).toContain(`background-color:${DEFAULT_EMAIL_BRAND.accent}`)
    expect(html).not.toContain('#0c862c')
  })

  it('draws the accent bar and links in the brand colour', async () => {
    const html = await branded(
      GREEN,
      <NewCommentEmail
        postTitle="Dark mode"
        postUrl="https://acme.example/p/1"
        commenterName="Ann"
        commentPreview="Yes please"
        isTeamMember={false}
        organizationName="Acme"
        unsubscribeUrl="https://acme.example/u"
      />
    )
    expect(html).toMatch(/width:3px;background-color:#0c862c/)
    expect(html).toMatch(/href="https:\/\/acme.example\/u"[^>]*color:#0c862c/)
    expect(html).not.toContain('#FFD43B')
  })

  it('renders a sign-in sample with the brand and the logo', async () => {
    const html = await renderSignInEmailSample({
      brand: GREEN,
      logoUrl: 'https://cdn.example/icon.png',
      workspaceName: 'Acme',
    })
    expect(html).toContain('Sign in to Acme')
    expect(html).toContain('https://cdn.example/icon.png')
    expect(html).toContain('background-color:#0c862c')
  })

  it('puts the header logo on its plate when the brand gives one', async () => {
    const sample = (brand: typeof GREEN & { logoPlate?: string }) =>
      renderSignInEmailSample({
        brand,
        logoUrl: 'https://cdn.example/icon.png',
        workspaceName: 'Acme',
      })
    const plated = await sample({ ...GREEN, logoPlate: '#18181b' })
    expect(plated).toMatch(/<img[^>]*icon\.png[^>]*background-color:#18181b/)
    expect(await sample(GREEN)).not.toContain('#18181b')
  })
})
