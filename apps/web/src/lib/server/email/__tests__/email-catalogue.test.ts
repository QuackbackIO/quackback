/**
 * The words emails are written with live in the app's catalogues: every
 * message an email template names is in en.json with the same English, and
 * every language formats every one of them with the same placeholders.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createIntl } from 'react-intl'
import { emailMessages, formatEnglish } from '@quackback/email'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'

const LOCALES_DIR = join(__dirname, '../../../../locales')
const catalogue = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8'))

const messages = [...emailMessages()]
const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{(\w+)/g)].map((m) => m[1]))].sort()
const sample = (text: string) =>
  Object.fromEntries(placeholders(text).map((name) => [name, `<${name}>`]))

describe('email catalogue', () => {
  it('names messages', () => {
    expect(messages.length).toBeGreaterThan(100)
  })

  it('keeps the English in code equal to en.json', () => {
    const en = catalogue('en')
    const drift = messages.filter(([id, english]) => en[id] !== english).map(([id]) => id)
    expect(drift).toEqual([])
  })

  it.each(SUPPORTED_LOCALES)('%s formats every email message with its placeholders', (locale) => {
    const strings = catalogue(locale)
    const errors: string[] = []
    const intl = createIntl({
      locale,
      messages: strings,
      onError: (error) => errors.push(String(error)),
    })
    for (const [id, english] of messages) {
      const text = strings[id]
      expect(text, `${locale} ${id}`).toBeTruthy()
      expect(placeholders(text!), `${locale} ${id}`).toEqual(placeholders(english))
      expect(text, `${locale} ${id}`).not.toMatch(/[–—]/)
      const values = sample(english)
      const formatted = intl.formatMessage({ id, defaultMessage: english }, values)
      // Every value reaches the text (an apostrophe before a placeholder
      // would quote it out in ICU).
      for (const value of Object.values(values)) {
        if (!/\{\w+, plural/.test(english)) expect(formatted, `${locale} ${id}`).toContain(value)
      }
    }
    expect(errors).toEqual([])
  })

  it('formats English the same without the catalogue as with it', () => {
    const intl = createIntl({ locale: 'en', messages: catalogue('en') })
    for (const [id, english] of messages) {
      expect(formatEnglish(english, sample(english)), id).toBe(
        intl.formatMessage({ id, defaultMessage: english }, sample(english))
      )
    }
  })
})
