/**
 * A widget bearer credential arrives in one of two shapes: the raw session
 * token (the widget identify endpoint mints and returns these), or the signed
 * form the auth library emits in its set-auth-token header,
 * `<token>.<signature>`. The session table stores the raw token, so every
 * direct lookup must normalize to the prefix first.
 *
 * No signature verification happens here on purpose: possession of the raw
 * prefix is exactly the credential the raw path already accepts, and the
 * signature exists to detect cookie tampering, not to strengthen bearer
 * possession. Session tokens never contain dots (alphanumeric or UUID), so
 * splitting on the first dot is unambiguous.
 */
export function rawSessionToken(bearerToken: string): string {
  const dot = bearerToken.indexOf('.')
  return dot === -1 ? bearerToken : bearerToken.slice(0, dot)
}
