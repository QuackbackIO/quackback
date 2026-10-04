import { FormattedMessage } from 'react-intl'
import { greetingName } from '@/lib/shared/greeting-name'

/** Home's heading: the person's first name, never their email address. */
export function HomeGreeting({ name, email }: { name?: string | null; email?: string | null }) {
  const first = greetingName(name, email)
  return (
    <h1 className="text-2xl font-semibold">
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
