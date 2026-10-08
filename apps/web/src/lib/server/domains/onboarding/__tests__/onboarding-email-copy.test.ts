/**
 * The setup emails and the team invitation in the recipient's language, from
 * the app's own catalogues: lang and dir match the language, the ready email
 * carries the link to share and the trial line, and no language ships a dash
 * the copy rules forbid.
 */
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import {
  invitationEmailCopy,
  nudgeEmailCopy,
  readyEmailCopy,
  recipientLocale,
} from '../onboarding-email-copy'

const BASE = 'https://acme.quackback.test'
const SHARE_STEP = {
  id: 'distribute-feedback',
  title: 'Share your board',
  url: `${BASE}/admin?open=share`,
}
const MESSENGER_STEP = {
  id: 'connect-messenger',
  title: 'Put Messenger on your site',
  url: `${BASE}/admin/settings/widget/install`,
}

function ready(locale: (typeof SUPPORTED_LOCALES)[number], trial = true) {
  return readyEmailCopy({
    locale,
    name: 'Sam',
    workspaceName: 'Acme',
    goal: 'product_feedback',
    base: BASE,
    nextStep: SHARE_STEP,
    homeUrl: `${BASE}/admin`,
    trial: trial ? { days: 14, planName: 'Pro' } : null,
  })
}

describe('recipientLocale', () => {
  it('takes the first supported language, else English', () => {
    expect(recipientLocale(null, 'de-DE', 'fr')).toBe('de')
    expect(recipientLocale('xx', undefined, 'pt-BR')).toBe('pt-br')
    expect(recipientLocale(null, 'klingon')).toBe('en')
  })
})

describe('readyEmailCopy', () => {
  it('reads as the mockup in English: share link, one step, trial line', async () => {
    const copy = await ready('en')

    expect(copy.subject).toBe('Acme is ready, Sam')
    expect(copy.lang).toBe('en')
    expect(copy.dir).toBe('ltr')
    expect(copy.paragraphs).toEqual([
      'Your board is live at acme.quackback.test.',
      'One step gets you to your first customer idea: share the link.',
      'You are on a 14-day Pro trial. No card needed, and Acme moves to Free if you do nothing.',
    ])
    expect(copy.share).toEqual({
      label: 'Your board link to share',
      url: `${BASE}/`,
      text: 'acme.quackback.test',
    })
    expect(copy.cta).toEqual({ label: 'Open Acme', url: `${BASE}/admin` })
    expect(copy.footer.unsubscribeLabel).toBe('Stop setup tips')
  })

  it('leaves the trial line out when there is no trial', async () => {
    const copy = await ready('en', false)
    expect(copy.paragraphs.join(' ')).not.toMatch(/trial/)
  })

  it('is written in German for a German recipient', async () => {
    const copy = await ready('de')
    expect(copy.lang).toBe('de')
    expect(copy.subject).not.toBe('Acme is ready, Sam')
    expect(copy.subject).toContain('Acme')
    expect(copy.paragraphs[0]).toContain('acme.quackback.test')
  })

  it('is right to left in Arabic', async () => {
    const copy = await ready('ar')
    expect(copy.lang).toBe('ar')
    expect(copy.dir).toBe('rtl')
    expect(copy.heading).not.toBe('Acme is ready')
  })

  it('names the help center and status page links for those goals', async () => {
    const help = await readyEmailCopy({
      locale: 'en',
      name: null,
      workspaceName: 'Acme',
      goal: 'help_center',
      base: BASE,
      nextStep: null,
      homeUrl: `${BASE}/admin`,
      trial: null,
    })
    expect(help.subject).toBe('Acme is ready')
    expect(help.share?.url).toBe(`${BASE}/hc`)
    const status = await readyEmailCopy({
      locale: 'en',
      name: 'Sam',
      workspaceName: 'Acme',
      goal: 'status_page',
      base: BASE,
      nextStep: null,
      homeUrl: `${BASE}/admin`,
      trial: null,
    })
    expect(status.share?.url).toBe(`${BASE}/status`)
  })

  it.each(SUPPORTED_LOCALES)('ships no em or en dash in %s', async (locale) => {
    const copy = await ready(locale)
    const nudge = await nudgeEmailCopy({
      locale,
      name: 'Sam',
      workspaceName: 'Acme',
      goal: 'product_feedback',
      base: BASE,
      nextStep: SHARE_STEP,
    })
    const invite = await invitationEmailCopy({
      locale,
      inviterName: 'Sam',
      inviteeName: 'Kim',
      workspaceName: 'Acme',
    })
    expect(JSON.stringify([copy, nudge, invite])).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('nudgeEmailCopy', () => {
  it('for support: names the next step on the button and offers nothing beside it', async () => {
    const copy = await nudgeEmailCopy({
      locale: 'en',
      name: 'Sam',
      workspaceName: 'Acme',
      goal: 'customer_support',
      base: BASE,
      nextStep: MESSENGER_STEP,
    })
    expect(copy.subject).toBe('Your next step in Acme')
    expect(copy.share).toBeNull()
    expect(copy.paragraphs[0]).toBe('No customer has started a conversation yet.')
    expect(copy.cta).toEqual({ label: 'Put Messenger on your site', url: MESSENGER_STEP.url })
    expect(copy.secondary).toBeNull()
  })

  it('translates the step title from the plan catalogue', async () => {
    const copy = await nudgeEmailCopy({
      locale: 'de',
      name: 'Sam',
      workspaceName: 'Acme',
      goal: 'customer_support',
      base: BASE,
      nextStep: MESSENGER_STEP,
    })
    expect(copy.cta.label).not.toBe('Put Messenger on your site')
    expect(copy.subject).not.toBe('Your next step in Acme')
  })
})

describe('invitationEmailCopy', () => {
  it('never names the inviter by email address', async () => {
    const copy = await invitationEmailCopy({
      locale: 'en',
      inviterName: 'sam@acme.example',
      inviteeName: null,
      workspaceName: 'Acme',
    })
    expect(copy.subject).toBe('A teammate invited you to Acme')
    expect(copy.heading).toBe('Join Acme')
  })
})
