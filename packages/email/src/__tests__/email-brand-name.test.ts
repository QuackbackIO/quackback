import { describe, it, expect } from 'vitest'
import { render } from '@react-email/components'
import { WelcomeEmail } from '../templates/welcome'
import { InvitationEmail } from '../templates/invitation'
import { MagicLinkEmail } from '../templates/magic-link'
import { PasswordResetEmail } from '../templates/password-reset'

const BRAND = 'Acme Feedback'

// React Email emits an empty comment between static text and an interpolated
// expression (`Sign in to {brandName}` → `Sign in to <!-- -->Acme Feedback`).
// Drop it so a heading reads as the plain phrase a recipient sees. This does not
// touch the "Powered by Quackback" footer, which is the separate attribution
// link and is expected to stay regardless of the brand name.
const phrases = (html: string) => html.replace(/<!-- -->/g, '')

describe('templates speak in the configured brand name', () => {
  it('WelcomeEmail uses the brand in the heading and sign-off', async () => {
    const html = phrases(
      await render(
        WelcomeEmail({
          name: 'Alice',
          workspaceName: 'Acme',
          dashboardUrl: 'https://example.com/dashboard',
          brandName: BRAND,
        })
      )
    )
    expect(html).toContain(`Welcome to ${BRAND}!`)
    expect(html).toContain(`The ${BRAND} Team`)
    expect(html).not.toContain('Welcome to Quackback!')
    expect(html).not.toContain('The Quackback Team')
  })

  it('InvitationEmail names the brand alongside the workspace', async () => {
    const html = phrases(
      await render(
        InvitationEmail({
          invitedByName: 'Bob',
          organizationName: 'Acme',
          inviteLink: 'https://example.com/invite',
          brandName: BRAND,
        })
      )
    )
    // Both halves stay distinct: the workspace is Acme, the product is the brand.
    expect(html).toContain('Acme')
    expect(html).toContain(`on ${BRAND}.`)
  })

  it('MagicLinkEmail uses the brand in the heading', async () => {
    const html = phrases(
      await render(
        MagicLinkEmail({
          signInUrl: 'https://example.com/verify-magic-link?token=abc',
          code: '123456',
          brandName: BRAND,
        })
      )
    )
    expect(html).toContain(`Sign in to ${BRAND}`)
    expect(html).not.toContain('Sign in to Quackback')
  })

  it('PasswordResetEmail uses the brand in the preview', async () => {
    const html = phrases(
      await render(PasswordResetEmail({ resetLink: 'https://example.com/reset', brandName: BRAND }))
    )
    expect(html).toContain(`Reset your ${BRAND} password`)
    expect(html).not.toContain('Reset your Quackback password')
  })
})

describe('templates default to Quackback when no brand is set', () => {
  it('WelcomeEmail falls back to Quackback', async () => {
    const html = phrases(
      await render(
        WelcomeEmail({
          name: 'Alice',
          workspaceName: 'Acme',
          dashboardUrl: 'https://example.com/dashboard',
        })
      )
    )
    expect(html).toContain('Welcome to Quackback!')
    expect(html).toContain('The Quackback Team')
  })

  it('MagicLinkEmail falls back to Quackback', async () => {
    const html = phrases(
      await render(
        MagicLinkEmail({
          signInUrl: 'https://example.com/verify-magic-link?token=abc',
          code: '123456',
        })
      )
    )
    expect(html).toContain('Sign in to Quackback')
  })

  it('PasswordResetEmail falls back to Quackback', async () => {
    const html = phrases(
      await render(PasswordResetEmail({ resetLink: 'https://example.com/reset' }))
    )
    expect(html).toContain('Reset your Quackback password')
  })
})
