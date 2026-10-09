import { createIntl } from 'react-intl'
import { describe, expect, it } from 'vitest'
import de from '@/locales/de.json'
import en from '@/locales/en.json'
import { DEFAULT_WELCOME_MESSAGE, shownGreeting } from '../default-greeting'

const german = createIntl({ locale: 'de', messages: de })

describe('shownGreeting', () => {
  it('speaks the visitor language when the workspace kept the default greeting', () => {
    expect(shownGreeting(DEFAULT_WELCOME_MESSAGE, german)).toBe(
      'Hallo! 👋 Wie können wir dir heute helfen?'
    )
    expect(shownGreeting(DEFAULT_WELCOME_MESSAGE, createIntl({ locale: 'en', messages: en }))).toBe(
      DEFAULT_WELCOME_MESSAGE
    )
  })

  it('never touches a greeting the team wrote', () => {
    expect(shownGreeting('Welcome to Acme support', german)).toBe('Welcome to Acme support')
    expect(shownGreeting(null, german)).toBeNull()
  })
})
