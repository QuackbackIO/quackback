// @vitest-environment happy-dom
/**
 * A workspace's own wording replaces the composer's prompt for readers of
 * that language. A language it left blank says the chosen word's translation,
 * never another language's own wording.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { FeedCopyContext, useFeedCopy } from '@/components/public/preview-draft-context'
import { PortalWordsIntl } from '@/lib/client/hooks/use-intl-setup'
import { FeedbackHeaderFallback } from '../feedback-header'

const COPY = { prompt: { en: 'Tell us anything' }, submit: { en: 'Send it', de: 'Abschicken' } }

function renderIn(locale: string, messages: Record<string, string> = {}) {
  function Copy() {
    const copy = useFeedCopy()
    return <p data-testid="copy">{JSON.stringify(copy)}</p>
  }
  render(
    <IntlProvider locale={locale} messages={messages} onError={() => {}}>
      <PortalWordsIntl>
        <FeedCopyContext.Provider value={COPY}>
          <FeedbackHeaderFallback />
          <Copy />
        </FeedCopyContext.Provider>
      </PortalWordsIntl>
    </IntlProvider>
  )
}

afterEach(cleanup)

describe('own wording', () => {
  it('replaces the composer prompt in its language', () => {
    renderIn('en')
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('Tell us anything')
    expect(JSON.parse(screen.getByTestId('copy').textContent!)).toEqual({
      prompt: 'Tell us anything',
      submit: 'Send it',
    })
  })

  it('leaves another language to the chosen word’s translation', () => {
    renderIn('de', {
      'portal.feedback.header.titlePlaceholder':
        '{postWord, select, suggestion {Was ist dein Vorschlag?} other {Was ist deine Idee?}}',
    })
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('Was ist deine Idee?')
    expect(JSON.parse(screen.getByTestId('copy').textContent!)).toEqual({ submit: 'Abschicken' })
  })
})
