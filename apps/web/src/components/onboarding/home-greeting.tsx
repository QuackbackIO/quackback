import { FormattedMessage } from 'react-intl'
import { greetingName } from '@/lib/shared/greeting-name'

/** Home's heading id: focus lands here when the first-run area empties under it. */
export const HOME_GREETING_ID = 'home-greeting'

/** Home's heading: the person's first name, never their email address. */
export function HomeGreeting({ name, email }: { name?: string | null; email?: string | null }) {
  const first = greetingName(name, email)
  return (
    <h1 id={HOME_GREETING_ID} tabIndex={-1} className="text-2xl font-semibold outline-none">
      {first ? (
        <FormattedMessage
          id="onboarding.home.greeting"
          defaultMessage="Welcome, {name}"
          values={{ name: first }}
        />
      ) : (
        <FormattedMessage id="onboarding.home.greetingPlain" defaultMessage="Welcome" />
      )}
    </h1>
  )
}
