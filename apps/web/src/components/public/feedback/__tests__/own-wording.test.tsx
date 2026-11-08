// @vitest-environment happy-dom
/**
 * A workspace's own wording replaces the composer's prompt for readers of
 * that language. A language it left blank says the portal's translation,
 * never another language's own wording.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { act } from 'react'
import { setDesignerPreview } from '@/components/public/preview-draft-context'
import {
  FeedCopyContext,
  PreviewSamplesContext,
  useDesignerPreview,
  useFeedCopy,
} from '@/components/public/preview-draft-context'
import { FeedbackHeaderFallback } from '../feedback-header'

const COPY = { prompt: { en: 'Tell us anything' }, submit: { en: 'Send it', de: 'Abschicken' } }

function renderIn(
  locale: string,
  messages: Record<string, string> = {},
  { designing = false } = {}
) {
  function Copy() {
    const copy = useFeedCopy()
    return <p data-testid="copy">{JSON.stringify(copy)}</p>
  }
  render(
    <IntlProvider locale={locale} messages={messages} onError={() => {}}>
      <PreviewSamplesContext.Provider value={designing}>
        <FeedCopyContext.Provider value={COPY}>
          <FeedbackHeaderFallback />
          <Copy />
        </FeedCopyContext.Provider>
      </PreviewSamplesContext.Provider>
    </IntlProvider>
  )
}

afterEach(() => {
  cleanup()
  setDesignerPreview({ empty: false, composer: false })
})

describe('own wording', () => {
  it('replaces the composer prompt in its language', () => {
    renderIn('en')
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('Tell us anything')
    expect(JSON.parse(screen.getByTestId('copy').textContent!)).toEqual({
      prompt: 'Tell us anything',
      submit: 'Send it',
    })
  })

  it('leaves another language to the portal’s translation', () => {
    renderIn('de', { 'portal.feedback.header.titlePlaceholder': 'Was möchtest du mitteilen?' })
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe(
      'Was möchtest du mitteilen?'
    )
    expect(JSON.parse(screen.getByTestId('copy').textContent!)).toEqual({ submit: 'Abschicken' })
  })
})

describe('in the builder', () => {
  it('draws the prompt as words to edit where they sit, never as the field’s placeholder', () => {
    renderIn('en', {}, { designing: true })
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('')
    const words = document.querySelector('[data-qb-words="feedback.prompt"]')!
    expect(words.textContent).toBe('Tell us anything')
  })

  it('leaves visitors the placeholder, with no words marked', () => {
    renderIn('en')
    expect(document.querySelector('[data-qb-words="feedback.prompt"]')).toBeNull()
  })

  it('shows what the builder asks for only while designing', () => {
    function Asked() {
      return <p data-testid="asked">{JSON.stringify(useDesignerPreview())}</p>
    }
    const view = render(
      <PreviewSamplesContext.Provider value={true}>
        <Asked />
      </PreviewSamplesContext.Provider>
    )
    act(() => setDesignerPreview({ empty: true }))
    expect(JSON.parse(screen.getByTestId('asked').textContent!)).toEqual({
      empty: true,
      composer: false,
    })
    view.unmount()
    render(<Asked />)
    expect(JSON.parse(screen.getByTestId('asked').textContent!)).toEqual({
      empty: false,
      composer: false,
    })
  })
})
