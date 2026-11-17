import { defineMessage } from 'react-intl'
import { signOut } from './auth-client'

/**
 * Signs out, and says whether it worked. The auth client hands a refusal back
 * as a value (a 403 Invalid origin, say), not a throw, so a caller that only
 * awaited it went on as if signed out while the session stayed.
 */
export async function signOutChecked(): Promise<boolean> {
  try {
    const result = (await signOut()) as { error?: unknown } | undefined
    return !result?.error
  } catch {
    return false
  }
}

/** What the portal says when a sign-out did not go through. */
export const SIGN_OUT_FAILED = defineMessage({
  id: 'portal.header.auth.signOutFailed',
  defaultMessage: "Couldn't sign you out. Try again.",
})
