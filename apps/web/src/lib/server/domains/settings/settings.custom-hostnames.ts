/**
 * Every custom hostname a workspace has set up: the custom domains in its
 * identity projection and every hostname a portal section names, lower-case.
 * A leaf module, so a test double of the settings readers can derive the same
 * set from the same inputs.
 */
import { parseIdentityProjection } from './cloud/identity-projection'

export function customHostnamesOf(
  cloudIdentity: unknown,
  sectionHostnames: readonly string[]
): ReadonlySet<string> {
  const hostnames = new Set<string>()
  for (const domain of parseIdentityProjection(cloudIdentity)?.customDomains ?? []) {
    hostnames.add(domain.hostname.toLowerCase())
  }
  for (const hostname of sectionHostnames) hostnames.add(hostname.toLowerCase())
  return hostnames
}
