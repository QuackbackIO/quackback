import { FormattedMessage } from 'react-intl'
import { greetingName } from '@/lib/shared/greeting-name'

/** Home's heading id: focus lands here when the first-run area empties under it. */
export const HOME_GREETING_ID = 'home-greeting'

/**
 * Home's heading: the person's first name, never their email address. It
 * says Welcome in the first sessions, while the launch plan leads Home, and
 * greets plainly after that.
 */
export function HomeGreeting({
  name,
  email,
  welcome,
  workspace,
}: {
  name?: string | null
  email?: string | null
  welcome: boolean
  /** Home's title when there is no name to greet. */
  workspace?: string | null
}) {
  const first = greetingName(name, email)
  return (
    <h1 id={HOME_GREETING_ID} tabIndex={-1} className="text-2xl font-semibold outline-none">
      {welcome ? (
        first ? (
          <FormattedMessage
            id="onboarding.home.greeting"
            defaultMessage="Welcome, {name}"
            values={{ name: first }}
          />
        ) : (
          <FormattedMessage id="onboarding.home.greetingPlain" defaultMessage="Welcome" />
        )
      ) : first ? (
        <FormattedMessage
          id="onboarding.home.greetingLater"
          defaultMessage="Hi, {name}"
          values={{ name: first }}
        />
      ) : (
        (workspace ?? <FormattedMessage id="admin.nav.home" defaultMessage="Home" />)
      )}
    </h1>
  )
}
