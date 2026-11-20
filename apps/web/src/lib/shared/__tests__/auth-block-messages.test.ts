import { describe, it, expect } from 'vitest'
import { AUTH_BLOCK_MESSAGES } from '../auth-block-messages'

/**
 * The magic-link plugin redirects a spent, unknown or expired link to its
 * `errorCallbackURL` with `error=INVALID_TOKEN` or `error=EXPIRED_TOKEN`,
 * uppercase. The sign-in toast looks the code up here verbatim, so a code
 * missing from the map shows the generic "Sign-in failed" copy instead of
 * telling the person to ask for a new link.
 */
describe('AUTH_BLOCK_MESSAGES for a used or expired sign-in link', () => {
  it.each(['INVALID_TOKEN', 'EXPIRED_TOKEN'])('%s says the link expired', (code) => {
    expect(AUTH_BLOCK_MESSAGES[code as keyof typeof AUTH_BLOCK_MESSAGES]).toBe(
      'Your login link has expired. Please request a new one.'
    )
  })
})
