import { useNavigate, useRouter } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/client/auth-client'

/**
 * The wizard's way back out of a session.
 *
 * Onboarding used to have none: whoever the browser was signed in as decided
 * which step loaded, and a visitor signed in as the wrong account had no
 * control they could reach. Lands on the account screen rather than the portal
 * root, which the root gate returns to onboarding until setup finishes.
 */
export function SignOutButton({
  className,
  variant = 'ghost',
  size,
}: {
  className?: string
  variant?: 'default' | 'ghost'
  size?: 'sm'
}) {
  const router = useRouter()
  const navigate = useNavigate()

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={async () => {
        try {
          await signOut()
        } finally {
          await router.invalidate()
          await navigate({ to: '/onboarding/account' })
        }
      }}
    >
      <FormattedMessage id="onboarding.signOut" defaultMessage="Sign out" />
    </Button>
  )
}
