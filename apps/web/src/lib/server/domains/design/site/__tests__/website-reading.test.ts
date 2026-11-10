/**
 * read_website's result: a capture's facts said with how the portal draws
 * their fonts and where their images are stored, and a refusal or a limit
 * said as a value the model can explain.
 */
import { describe, expect, it } from 'vitest'
import { websiteReadingSchema } from '@/lib/shared/design/agent/website-tool'
import { readingOf } from '../website-reading'
import type { SiteFacts } from '../types'

const facts = {
  url: 'https://www.acme.test/',
  name: 'Acme Parcel',
  nameFrom: 'og:site_name',
  language: 'en-gb',
  description: 'Parcels delivered the same day.',
  themeColour: '#123c69',
  favicons: [],
  logos: [],
  shareImage: null,
  fonts: {
    heading: {
      family: 'EB Garamond',
      stack: ['EB Garamond', 'Georgia', 'serif'],
      generic: 'serif',
      from: 'h1',
    },
    body: { family: 'Inter', stack: ['Inter', 'sans-serif'], generic: 'sans', from: 'body' },
    faces: [],
    hosted: ['EB Garamond'],
  },
  colours: [{ hex: '#123c69', from: '--brand-primary', weight: 3 }],
  stylesheets: [],
  manifest: null,
} as SiteFacts

const usage = { workspaceDayLeft: 4, userHourLeft: 2, instanceMonthLeft: 80 }

describe('readingOf', () => {
  it('says a kept capture’s facts, fonts and stored images', () => {
    const reading = readingOf({
      ok: true,
      host: 'acme.test',
      url: 'https://www.acme.test/',
      cached: true,
      capturedAt: new Date(),
      image: { key: 'site-captures/acme.test/1.png', width: 1440, height: 900 },
      facts,
      assets: {
        favicon: {
          key: 'logos/site/acme.test/1-favicon.png',
          url: 'https://www.acme.test/f.png',
          mime: 'image/png',
          width: 64,
          height: 64,
          from: 'icon',
        },
      },
      usage,
    } as never)
    expect(websiteReadingSchema.safeParse(reading).success).toBe(true)
    expect(reading.status).toEqual({
      source: 'cache',
      fallback: null,
      message: null,
      capturesLeftToday: 4,
    })
    expect(reading.facts!.fonts.heading).toMatchObject({
      family: 'EB Garamond',
      how: 'open',
      id: 'source-serif',
    })
    expect(reading.facts!.fonts.body).toMatchObject({
      family: 'Inter',
      how: 'bundled',
      id: 'inter',
    })
    expect(reading.facts!.favicon).toMatchObject({
      kind: 'png',
      key: 'logos/site/acme.test/1-favicon.png',
      agrees: null,
    })
    expect(reading.facts!.logo).toBeNull()
  })

  it('says a limit as a value, with the facts it could read', () => {
    const reading = readingOf({
      ok: false,
      host: 'acme.test',
      reason: 'limit',
      limit: 'workspace_day',
      facts,
      message: 'Captures are used up for today.',
    } as never)
    expect(reading).toMatchObject({
      ok: false,
      status: { source: 'none', fallback: 'limit', message: 'Captures are used up for today.' },
    })
    expect(reading.facts!.name).toBe('Acme Parcel')
  })
})
