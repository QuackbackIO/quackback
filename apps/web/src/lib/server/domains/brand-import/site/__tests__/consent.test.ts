import { describe, expect, it } from 'vitest'
import { CONSENT_WORDS, isConsentSelector, isConsentStylesheet } from '../consent'

describe('consent rule', () => {
  it('names consent containers by their markup', () => {
    for (const selector of [
      '#onetrust-consent-sdk .ot-btn',
      '.optanon-alert-box-wrapper .optanon-button-allow',
      '.cookie-banner button',
      '#CybotCookiebotDialog .btn',
      '.cmp-root .cta',
      '.privacy-banner__actions button',
      '[data-testid="consent-bar"] .btn',
    ]) {
      expect(isConsentSelector(selector), selector).toBe(true)
    }
  })

  it('leaves brand markup alone, tracking utilities included', () => {
    for (const selector of [
      '.hero .btn-primary',
      'button.cta',
      '.tracking-tight',
      '.order-tracking button',
      '.privacy-first .btn',
      'footer a',
    ]) {
      expect(isConsentSelector(selector), selector).toBe(false)
    }
  })

  it('names consent platform stylesheets by host or path', () => {
    expect(isConsentStylesheet('https://cdn.consentkit.example/banner.css')).toBe(true)
    expect(isConsentStylesheet('https://acme.test/assets/cookie-banner.css')).toBe(true)
    expect(isConsentStylesheet('https://acme.test/assets/app.css?v=cookie')).toBe(false)
    expect(isConsentStylesheet('https://acme.test/assets/app.css')).toBe(false)
    expect(isConsentStylesheet('not a url')).toBe(false)
  })

  it('reads consent words in several languages', () => {
    expect(CONSENT_WORDS.test('We use cookies to improve your visit')).toBe(true)
    expect(CONSENT_WORDS.test('Datenschutz-Einstellungen')).toBe(true)
    expect(CONSENT_WORDS.test('Start your free trial')).toBe(false)
  })
})
