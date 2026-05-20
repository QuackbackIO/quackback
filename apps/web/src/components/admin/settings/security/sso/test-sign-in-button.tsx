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

export function TestSignInButton({ disabled }: { disabled?: boolean }) {
  const { open } = useSsoTestSignIn()
  return (
    <Button onClick={() => open()} disabled={disabled} variant="outline">
      Test sign-in
    </Button>
  )
}
