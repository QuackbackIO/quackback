// @vitest-environment happy-dom
import { Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import { FormattedMessage, IntlProvider } from 'react-intl'
import { expect, it } from 'vitest'
import { loadMessages, adminSeedMessages } from '@/lib/shared/i18n'
import { SheetMessages } from '../sheet-messages'

it('loads the setup sheet strings that the page seed leaves out', async () => {
  const seeded = adminSeedMessages(await loadMessages('fr'))
  expect(seeded['onboarding.test.badge']).toBeUndefined()
  // React retries a suspended use() only inside act.
  await act(async () => {
    render(
      <IntlProvider locale="fr" messages={seeded} onError={() => {}}>
        <Suspense fallback={<p>Loading</p>}>
          <SheetMessages>
            <p>
              <FormattedMessage
                id="onboarding.live.install.title"
                defaultMessage="Put Messenger on your site"
              />
            </p>
            <p>
              <FormattedMessage id="onboarding.launch.name" defaultMessage="Launch plan" />
            </p>
          </SheetMessages>
        </Suspense>
      </IntlProvider>
    )
  })
  const all = await loadMessages('fr')
  expect(await screen.findByText(all['onboarding.live.install.title']!)).toBeTruthy()
  expect(screen.getByText(seeded['onboarding.launch.name']!)).toBeTruthy()
})
