/**
 * Test-side client for the OIDC provider fake (stand-ins/fake-oidc.ts).
 *
 *   const idp = fakeOidc.tenant(marker)               // this test's own provider
 *   await fakeOidc.script(marker, { claims: { sub, email, name } })
 *   ... save an identity provider with discoveryUrl: idp.discoveryUrl ...
 *   ... sign in through it in a browser context with ignoreHTTPSErrors ...
 *   const calls = await fakeOidc.requests(marker)
 *
 * The browser follows the authorize redirect to the fake, whose certificate is
 * the suite's own self-signed one: open that context with
 * `ignoreHTTPSErrors: true`. The app trusts it through NODE_EXTRA_CA_CERTS.
 */
import type { FakeOidcScript, RecordedOidcRequest } from './stand-ins/fake-oidc'
import { supportEnv } from './env'

export type { FakeOidcScript, RecordedOidcRequest }

function control(path: string): string {
  return `${supportEnv().oidcFakeControlUrl}${path}`
}

/** A tenant name the fake accepts: the marker's letters, digits, dot, dash, underscore. */
function tenantName(marker: string): string {
  const name = marker.replace(/[^A-Za-z0-9._-]/g, '-')
  if (name.length < 4) throw new Error(`OIDC fake tenant "${marker}" is too short`)
  return name
}

export const fakeOidc = {
  /** The issuer and discovery URL of the provider for this marker. */
  tenant(marker: string): { issuer: string; discoveryUrl: string } {
    const issuer = `${supportEnv().oidcFakeOrigin}/${tenantName(marker)}`
    return { issuer, discoveryUrl: `${issuer}/.well-known/openid-configuration` }
  },

  /** Script this marker's provider: who signs in, and how it fails. */
  async script(marker: string, script: FakeOidcScript): Promise<void> {
    const res = await fetch(control(`/__oidc/tenants/${tenantName(marker)}`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(script),
    })
    if (!res.ok) throw new Error(`OIDC fake script failed: ${res.status} ${await res.text()}`)
  },

  /** Requests this marker's provider received, oldest first. */
  async requests(marker: string): Promise<RecordedOidcRequest[]> {
    const res = await fetch(control(`/__oidc/requests?tenant=${tenantName(marker)}`))
    if (!res.ok) throw new Error(`OIDC fake requests failed: ${res.status}`)
    return (await res.json()) as RecordedOidcRequest[]
  },
}
