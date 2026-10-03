// @vitest-environment happy-dom
import { Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import { FormattedMessage, IntlProvider } from 'react-intl'
import { expect, it } from 'vitest'
import { loadMessages, withoutViewerMessages } from '@/lib/shared/i18n'
import { AskMessages } from '../ask-messages'

it('loads Copilot strings that the page seed leaves out', async () => {
  const seeded = withoutViewerMessages(await loadMessages('fr'))
  expect(seeded['ask.chat.newChat']).toBeUndefined()
  // React retries a suspended use() only inside act.
  await act(async () => {
    render(
      <IntlProvider locale="fr" messages={seeded} onError={() => {}}>
        <Suspense fallback={<p>Loading</p>}>
          <AskMessages>
            <p>
              <FormattedMessage id="ask.chat.newChat" defaultMessage="New chat" />
            </p>
            <p>
              <FormattedMessage id="onboarding.launch.title" defaultMessage="Your launch plan" />
            </p>
          </AskMessages>
        </Suspense>
      </IntlProvider>
    )
  })
  expect(await screen.findByText('Nouvelle discussion')).toBeTruthy()
  expect(screen.getByText(seeded['onboarding.launch.title']!)).toBeTruthy()
})
