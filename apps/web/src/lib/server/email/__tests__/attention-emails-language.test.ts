/**
 * The plan limits, domain attention and sending domain attention emails read
 * in the reader's language from the app's catalogues: their subjects, their
 * sentences, the cap and feature names, and the plural forms.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DomainAttentionEmail,
  PlanLimitsEmail,
  SendingDomainAttentionEmail,
  domainAttentionTitle,
  planLimitsSubject,
  sendingDomainAttentionTitle,
} from '@quackback/email'
import { emailLocaleFor } from '../email-locale'

const text = (html: string) =>
  html
    .replace(/<\/?strong>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')

describe('attention emails in the reader language', () => {
  it('writes the plan limits email in German, with German plurals and feature names', async () => {
    const i18n = await emailLocaleFor('de')
    const html = renderToStaticMarkup(
      PlanLimitsEmail({
        kind: 'start',
        workspaceName: 'Acme',
        planName: 'Free',
        fromPlanName: 'Pro',
        deadline: '24. Nov.',
        deadlineHeading: 'Di., 24. Nov.',
        rows: [
          { key: 'maxBoards', used: 5, cap: 1 },
          { key: 'maxTeamSeats', used: 2, cap: 1 },
        ],
        pausingFeatures: ['webhooks', 'customDomain'],
        limitsUrl: 'https://app.example.com/limits',
        planUrl: 'https://app.example.com/billing',
        i18n,
      })
    )
    const body = text(html)
    expect(html).toContain('lang="de"')
    expect(body).toContain('Behebe 2 Probleme bis Di., 24. Nov.')
    expect(body).toContain('Boards: 5 von 1. 4 Boards werden schreibgeschützt.')
    expect(body).toContain(
      'Team-Plätze: 2 von 1. 1 Teammitglied verliert den Admin-Zugriff, bis ein Platz frei wird.'
    )
    expect(body).toContain('Nach dem 24. Nov. pausieren Webhooks und deine eigene Domain.')
    expect(body).toContain('Upgrade auf Pro')
    expect(body).not.toMatch(/Nothing is deleted|Review issues|pause after/)
    expect(planLimitsSubject('start', 'Acme', 'Free', undefined, i18n)).toBe(
      'Handlungsbedarf: Acme überschreitet die Limits des Tarifs Free'
    )
  })

  it('uses the plural forms of a language with more than two', async () => {
    const i18n = await emailLocaleFor('pl')
    const rows = (used: number) =>
      text(
        renderToStaticMarkup(
          PlanLimitsEmail({
            kind: 'start',
            deadline: '24 lis',
            deadlineHeading: 'wt., 24 lis',
            rows: [{ key: 'maxBoards', used, cap: 1 }],
            pausingFeatures: [],
            limitsUrl: null,
            planUrl: null,
            i18n,
          })
        )
      )
    expect(rows(2)).toContain('1 tablica będzie tylko do odczytu')
    expect(rows(4)).toContain('3 tablice będą tylko do odczytu')
    expect(rows(7)).toContain('6 tablic będzie tylko do odczytu')
  })

  it('writes the domain attention email in French', async () => {
    const i18n = await emailLocaleFor('fr')
    const body = text(
      renderToStaticMarkup(
        DomainAttentionEmail({
          domain: 'acme.com',
          record: { name: '_quackback.acme.com', value: 'token' },
          deadline: '8 novembre 2026',
          settingsUrl: 'https://app.example.com/domains',
          workspaceName: 'Acme',
          i18n,
        })
      )
    )
    expect(body).toContain('acme.com nécessite votre attention')
    expect(body).toContain('Rajoutez-le avant le 8 novembre 2026 pour que acme.com reste vérifié.')
    expect(body).toContain('Ouvrez les paramètres du domaine')
    expect(domainAttentionTitle('acme.com', true, i18n)).toBe('acme.com n’est plus vérifié')
  })

  it('writes the sending domain attention email in Spanish, naming the record', async () => {
    const i18n = await emailLocaleFor('es')
    const body = text(
      renderToStaticMarkup(
        SendingDomainAttentionEmail({
          domain: 'acme.com',
          record: {
            purpose: 'dkim',
            type: 'CNAME',
            name: 'qb._domainkey.acme.com',
            state: 'missing',
          },
          i18n,
        })
      )
    )
    expect(body).toContain('El registro DKIM (CNAME qb._domainkey.acme.com) falta.')
    expect(body).toContain('el correo de este dominio sale desde tu dirección predeterminada')
    expect(sendingDomainAttentionTitle('acme.com', i18n)).toBe(
      'El envío desde acme.com necesita tu atención'
    )
  })
})
