/**
 * The lockout guard the provider list and the provider page share. Its own
 * module so the Access & Security list loads this line and not
 * `provider-shared`, which carries the editor's vocabulary.
 */

/** This provider is the last thing standing between the workspace and a
 *  no-auth lockout when it's the sole enabled + configured sign-in method;
 *  turning it off (or removing it) must be blocked. */
export function isOnlyWorkingMethod(
  provider: { enabled: boolean; configured: boolean } | null | undefined,
  enabledMethodCount: number
): boolean {
  return enabledMethodCount === 1 && !!provider?.enabled && !!provider?.configured
}
