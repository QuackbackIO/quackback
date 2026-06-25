/**
 * Standalone "Test sign-in" button. Thin wrapper now — the modal, the
 * popup/poll lifecycle, and the result rendering all live in
 * `<SsoTestSignInProvider>` / `useSsoTestSignIn`, shared with the
 * Enable / Require-SSO gate prompts. This button just opens the modal
 * in its prompt state with no gate `reason` (it's a plain "does my
 * config work?" check, not a precondition for an action).
 */

import { Button } from '@/components/ui/button'
import { useSsoTestSignIn } from './use-sso-test-sign-in'

export function TestSignInButton({
  registrationId,
  disabled,
}: {
  /** The provider's registrationId — forwarded to `startSsoTestFn` so the
   *  test exercises THIS provider's credentials and stamps its own gate. */
  registrationId: string
  disabled?: boolean
}) {
  const { open } = useSsoTestSignIn()
  return (
    <Button onClick={() => open({ registrationId })} disabled={disabled} variant="outline">
      Test sign-in
    </Button>
  )
}
