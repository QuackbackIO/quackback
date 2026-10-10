import { z } from 'zod'

/**
 * The one shape check for an emailed unsubscribe token, shared by the
 * /unsubscribe page, its server functions and the one-click POST.
 *
 * Tokens are minted with `randomUUID()`. Links arrive rewritten, truncated or
 * guessed (mail scanners open every link in a message), so a token that fails
 * this check is an invalid link to show, never an error to throw.
 */
const unsubscribeTokenSchema = z.string().uuid()

export function isUnsubscribeToken(token: unknown): token is string {
  return unsubscribeTokenSchema.safeParse(token).success
}
