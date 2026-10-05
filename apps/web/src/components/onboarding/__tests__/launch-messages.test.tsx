// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { FormattedMessage, IntlProvider } from 'react-intl'
import { expect, it } from 'vitest'
import { adminSeedMessages, loadLaunchMessages, loadMessages } from '@/lib/shared/i18n'
import { LaunchMessages } from '../launch-messages'

it('adds the route-loaded launch strings to the page seed', async () => {
  const all = await loadMessages('fr')
  const seeded = adminSeedMessages(all)
  expect(seeded['onboarding.win.generic']).toBeUndefined()
  render(
    <IntlProvider locale="fr" messages={seeded} onError={() => {}}>
      <LaunchMessages messages={await loadLaunchMessages('fr')}>
        <p>
          <FormattedMessage id="onboarding.win.generic" defaultMessage="First win" />
        </p>
        <p>
          <FormattedMessage id="onboarding.launch.name" defaultMessage="Launch plan" />
        </p>
      </LaunchMessages>
    </IntlProvider>
  )
  expect(screen.getByText(all['onboarding.win.generic']!)).toBeTruthy()
  expect(screen.getByText(seeded['onboarding.launch.name']!)).toBeTruthy()
})
