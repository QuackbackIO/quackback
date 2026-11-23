/**
 * The consent page posts Better Auth's signed authorize query back unchanged.
 * Signed here as Better Auth signs it (repeated `ba_param`, a repeated
 * `resource`, numbers-looking values) and run through the router's own search
 * parse and stringify, the same steps a browser visit goes through.
 */
import { describe, expect, it } from 'vitest'
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router'
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { makeSignature } from 'better-auth/crypto'
import {
  CONSENT_PAGE_PATH,
  CONSENT_QUERY_PARAM,
  consentPageLocation,
  consentQueryFields,
  consentQueryFromSearch,
} from '@/lib/shared/oauth-consent-query'

const SECRET = 'consent-query-test-secret-at-least-32-chars'

/** A query signed the way Better Auth's authorize endpoint signs one. */
async function signedQuery(state: string): Promise<string> {
  const params = new URLSearchParams()
  params.set('response_type', 'code')
  params.set('client_id', 'client-1')
  params.set('redirect_uri', 'http://127.0.0.1:47819/callback')
  params.set('scope', 'openid read:feedback write:feedback')
  params.set('state', state)
  params.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  params.set('code_challenge_method', 'S256')
  params.append('resource', 'http://localhost:3000/api/mcp')
  params.append('resource', 'http://localhost:3000/api/other')
  params.set('qb_requested_scope', 'openid read:feedback')
  params.set('exp', String(Math.floor(Date.now() / 1000) + 600))
  params.set('ba_iat', String(Date.now()))
  for (const name of [...new Set([...params.keys(), 'ba_param'])].sort()) {
    params.append('ba_param', name)
  }
  const canonical = new URLSearchParams(
    [...params.entries()].sort(([a, av], [b, bv]) =>
      a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0
    )
  )
  params.set('sig', await makeSignature(canonical.toString(), SECRET))
  return params.toString()
}

/** What the router turns a URL's search into, and how it writes it back. */
function throughRouter(search: string) {
  const parsed = defaultParseSearch(search)
  return { parsed, written: defaultStringifySearch(parsed) }
}

// Numbers-looking states the router would retype: precision lost, `1.0`
// written as `1`, `1e3` as `1000`.
const STATES = ['k3Jx-9q_state', '12345678901234567890', '1.0', '1e3', 'true']

describe('consent signed query', () => {
  it('the router rewrites a signed query spread over the URL, and its signature fails', async () => {
    const raw = await signedQuery('k3Jx-9q_state')
    const { written } = throughRouter(`?${raw}`)
    expect(written).toContain('ba_param=%5B')
    expect(await verifyOAuthQueryParams(written.slice(1), SECRET)).toBe(false)
  })

  it.each(STATES)('carries the query to the page unchanged (state %s)', async (state) => {
    const raw = await signedQuery(state)
    expect(await verifyOAuthQueryParams(raw, SECRET)).toBe(true)

    const location = consentPageLocation(`?${raw}`)
    const search = location.slice(CONSENT_PAGE_PATH.length)
    expect(location.startsWith(`${CONSENT_PAGE_PATH}?client_id=client-1&`)).toBe(true)
    expect(new URLSearchParams(search).get(CONSENT_QUERY_PARAM)).toBe(raw)
    const { parsed, written } = throughRouter(search)

    // The router writes the URL back as it came, so it never redirects it.
    expect(written).toBe(search)
    const posted = consentQueryFromSearch(parsed)
    expect(posted).toBe(raw)
    expect(await verifyOAuthQueryParams(posted, SECRET)).toBe(true)
  })

  it('reads what the page shows from the carried query', async () => {
    const raw = await signedQuery('12345678901234567890')
    const { parsed } = throughRouter(consentPageLocation(raw).slice(CONSENT_PAGE_PATH.length))
    expect(consentQueryFields(consentQueryFromSearch(parsed))).toEqual({
      clientId: 'client-1',
      scope: 'openid read:feedback write:feedback',
      redirectUri: 'http://127.0.0.1:47819/callback',
      requested: 'openid read:feedback',
    })
  })

  it('rebuilds repeated keys from a link that spread the query over the URL', async () => {
    const raw = await signedQuery('k3Jx-9q_state')
    const { parsed } = throughRouter(`?${raw}`)
    const rebuilt = consentQueryFromSearch(parsed)
    expect(new URLSearchParams(rebuilt).getAll('ba_param')).toEqual(
      new URLSearchParams(raw).getAll('ba_param')
    )
    expect(await verifyOAuthQueryParams(rebuilt, SECRET)).toBe(true)
  })
})
