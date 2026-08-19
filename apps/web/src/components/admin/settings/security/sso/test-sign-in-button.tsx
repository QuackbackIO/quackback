/**
 * Standalone "Test sign-in" button. Thin wrapper now — the modal, the
 * popup/poll lifecycle, and the result rendering all live in
 * `<SsoTestSignInProvider>` / `useSsoTestSignIn`, shared with the
 * Enable / Require-SSO gate prompts. This button just opens the modal
 * in its prompt state with no gate `reason` (it's a plain "does my
 * config work?" check, not a precondition for an action).
 */

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useSsoTestSignIn } from './use-sso-test-sign-in'

export function TestSignInButton({
  registrationId,
  disabled,
  size = 'sm',
  variant = 'outline',
  children = 'Test sign-in',
}: {
  /** The provider's registrationId — forwarded to `startSsoTestFn` so the
   *  test exercises THIS provider's credentials and stamps its own gate. */
  registrationId: string
  disabled?: boolean
  size?: 'sm' | 'default'
  variant?: 'outline' | 'link' | 'ghost'
  children?: ReactNode
}) {
  const { open } = useSsoTestSignIn()
  return (
    <Button
      type="button"
      onClick={() => open({ registrationId })}
      disabled={disabled}
      variant={variant}
      size={size}
    >
      {children}
    </Button>
  )
}
