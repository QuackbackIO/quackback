/** Test credentials only work through the bearer-only widget exchange. */
export const TEST_CUSTOMER_SESSION_PREFIX = 'customer-session-'
export const TEST_CUSTOMER_VERIFICATION_PREFIX = 'test-customer-token:'

export type PhoneCodeProblem = 'missing' | 'used' | 'expired'

/**
 * Why the phone page has no test session. A code carries its expiry, so a
 * refused code before that time was already used, and after it had expired.
 */
export function phoneCodeProblem({
  hadCode,
  expiresAt,
  now = Date.now(),
}: {
  hadCode: boolean
  expiresAt: number | null
  now?: number
}): PhoneCodeProblem {
  if (!hadCode) return 'missing'
  return expiresAt !== null && now >= expiresAt ? 'expired' : 'used'
}
