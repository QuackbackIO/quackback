/**
 * The OIDC provider fake allowance: the exception the SSRF guard makes for
 * identity-provider URLs only, so the e2e suites can sign people in through a
 * local single sign-on provider.
 *
 * A URL is the fake only when ALL of these hold:
 * - the harness gate is open (`./gate.ts`);
 * - `E2E_OIDC_FAKE_HOST` names it, as `host:port`, compared exactly;
 * - that configured hostname is itself a loopback name (`*.localhost`), so the
 *   variable cannot be pointed at a private network address;
 * - the URL is `https:` (as every identity-provider URL must be).
 *
 * Even then the guard only lets it resolve to loopback addresses, and the
 * certificate is still verified (the suite trusts its own CA through
 * NODE_EXTRA_CA_CERTS). Only the identity-provider callers ask for this
 * allowance; every other caller of the guard refuses the fake as private.
 */
import { isE2eHarnessEnabled } from './gate'
import { isNamedLoopbackHttpsUrl } from './webhook-sink'

type EnvLike = Record<string, string | undefined>

const OIDC_FAKE_HOST_ENV = 'E2E_OIDC_FAKE_HOST'

export function isE2eOidcFakeUrl(url: string, env: EnvLike = process.env): boolean {
  if (!isE2eHarnessEnabled(env)) return false
  return isNamedLoopbackHttpsUrl(url, env[OIDC_FAKE_HOST_ENV])
}
