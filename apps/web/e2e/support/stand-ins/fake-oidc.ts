/**
 * The OIDC provider fake: a minimal single sign-on provider for the product
 * e2e suite, on the one named host the app's identity-provider URL guard may
 * reach in tests (`oidc-fake.localhost`, see
 * src/lib/server/e2e-harness/oidc-fake.ts), plus a plain-http control port on
 * 127.0.0.1.
 *
 * Every test is its own provider: a TENANT (a marker) is the first path
 * segment, so `https://oidc-fake.localhost:<port>/<tenant>` is the issuer and
 *
 *   GET  /<tenant>/.well-known/openid-configuration   discovery
 *   GET  /<tenant>/authorize                          redirects back with a code (or ?error=)
 *   POST /<tenant>/token                              code -> access token + RS256 ID token
 *   GET  /<tenant>/userinfo                           the claims, for the access token
 *   GET  /<tenant>/jwks                               the signing key
 *
 * Control API (http://127.0.0.1:<control port>, via e2e/support/fake-oidc-client.ts):
 *   POST /__oidc/tenants/<tenant>          script it (see FakeOidcScript)
 *   GET  /__oidc/requests?tenant=...       recorded requests, oldest first
 *   GET  /__oidc/health
 *
 * An unscripted tenant signs in `<tenant>-user` <<tenant>@oidc.test>, email
 * verified, and accepts any client secret.
 *
 * Run: bun e2e/support/stand-ins/fake-oidc.ts   (ports from support.env)
 */
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createHttpServer, type IncomingMessage } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { supportEnv } from '../env'
import { ensureSinkCertificate } from './tls'

export interface FakeOidcScript {
  /** Claims for the signed-in person (ID token and userinfo). `sub` and `email` at least. */
  claims?: Record<string, unknown>
  /** When set, the token endpoint refuses any other client secret (401). */
  clientSecret?: string
  /** Redirect back from /authorize with this `error` instead of a code. */
  error?: string
  /** Answer the token endpoint with this status instead. */
  tokenStatus?: number
  /** Sign the ID token with a key the JWKS does not publish. */
  badSignature?: boolean
}

export interface RecordedOidcRequest {
  seq: number
  at: string
  tenant: string
  endpoint: 'discovery' | 'authorize' | 'token' | 'userinfo' | 'jwks' | 'unknown'
  method: string
  query: Record<string, string>
  /** The form body (token endpoint), decoded. */
  form: Record<string, string>
  status: number
}

interface IssuedCode {
  tenant: string
  clientId: string
  redirectUri: string
  nonce: string | null
  codeChallenge: string | null
  scope: string
}

const MAX_RECORDED = 2_000
const KEY_ID = 'fake-oidc-key'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function defaultClaims(tenant: string): Record<string, unknown> {
  return {
    sub: `${tenant}-user`,
    email: `${tenant}@oidc.test`,
    email_verified: true,
    name: `OIDC ${tenant}`,
  }
}

if (import.meta.main) {
  const env = supportEnv()
  ensureSinkCertificate(env.sinkCertPath, env.sinkKeyPath)
  const origin = env.oidcFakeOrigin

  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const { privateKey: strayKey } = await generateKeyPair('RS256', { extractable: true })
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: 'RS256', use: 'sig' }

  const scripts = new Map<string, FakeOidcScript>()
  const codes = new Map<string, IssuedCode>()
  const accessTokens = new Map<string, { tenant: string }>()
  const requests: RecordedOidcRequest[] = []
  let seq = 0

  function record(entry: Omit<RecordedOidcRequest, 'seq' | 'at'>) {
    requests.push({ seq: ++seq, at: new Date().toISOString(), ...entry })
    if (requests.length > MAX_RECORDED) requests.splice(0, requests.length - MAX_RECORDED)
  }

  function claimsFor(tenant: string): Record<string, unknown> {
    return { ...defaultClaims(tenant), ...(scripts.get(tenant)?.claims ?? {}) }
  }

  function clientCredentials(req: IncomingMessage, form: Record<string, string>) {
    const header = req.headers.authorization ?? ''
    if (header.startsWith('Basic ')) {
      const [id, secret] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':')
      return {
        clientId: decodeURIComponent(id ?? ''),
        clientSecret: decodeURIComponent(secret ?? ''),
      }
    }
    return { clientId: form.client_id ?? '', clientSecret: form.client_secret ?? '' }
  }

  const provider = createHttpsServer(
    { key: readFileSync(env.sinkKeyPath), cert: readFileSync(env.sinkCertPath) },
    async (req, res) => {
      const url = new URL(req.url ?? '/', origin)
      const [, tenant = '', ...rest] = url.pathname.split('/')
      const sub = `/${rest.join('/')}`
      const issuer = `${origin}/${tenant}`
      const query = Object.fromEntries(url.searchParams)
      const body = req.method === 'POST' ? await readBody(req) : ''
      const form = Object.fromEntries(new URLSearchParams(body))
      const script = scripts.get(tenant) ?? {}
      const json = (status: number, value: unknown, endpoint: RecordedOidcRequest['endpoint']) => {
        record({ tenant, endpoint, method: req.method ?? 'GET', query, form, status })
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(value))
      }

      if (!tenant) return json(404, { error: 'no tenant' }, 'unknown')

      if (sub === '/.well-known/openid-configuration') {
        return json(
          200,
          {
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            userinfo_endpoint: `${issuer}/userinfo`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            scopes_supported: ['openid', 'email', 'profile'],
            grant_types_supported: ['authorization_code'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
            claims_supported: ['sub', 'email', 'email_verified', 'name', 'picture'],
          },
          'discovery'
        )
      }

      if (sub === '/jwks') return json(200, { keys: [publicJwk] }, 'jwks')

      if (sub === '/authorize') {
        const redirectUri = query.redirect_uri
        if (!redirectUri || !query.client_id) {
          return json(400, { error: 'invalid_request' }, 'authorize')
        }
        const back = new URL(redirectUri)
        if (query.state) back.searchParams.set('state', query.state)
        back.searchParams.set('iss', issuer)
        if (script.error) {
          back.searchParams.set('error', script.error)
        } else {
          const code = base64url(randomBytes(24))
          codes.set(code, {
            tenant,
            clientId: query.client_id,
            redirectUri,
            nonce: query.nonce ?? null,
            codeChallenge: query.code_challenge ?? null,
            scope: query.scope ?? 'openid',
          })
          back.searchParams.set('code', code)
        }
        record({ tenant, endpoint: 'authorize', method: 'GET', query, form, status: 302 })
        res.writeHead(302, { location: back.href })
        res.end()
        return
      }

      if (sub === '/token' && req.method === 'POST') {
        if (script.tokenStatus) return json(script.tokenStatus, { error: 'server_error' }, 'token')
        const issued = codes.get(form.code ?? '')
        codes.delete(form.code ?? '')
        const { clientId, clientSecret } = clientCredentials(req, form)
        if (!issued || issued.tenant !== tenant)
          return json(400, { error: 'invalid_grant' }, 'token')
        if (issued.redirectUri !== form.redirect_uri) {
          return json(400, { error: 'invalid_grant', error_description: 'redirect_uri' }, 'token')
        }
        if (clientId !== issued.clientId) return json(401, { error: 'invalid_client' }, 'token')
        if (script.clientSecret !== undefined && clientSecret !== script.clientSecret) {
          return json(401, { error: 'invalid_client' }, 'token')
        }
        if (issued.codeChallenge) {
          const verifier = form.code_verifier ?? ''
          const challenge = base64url(createHash('sha256').update(verifier).digest())
          if (challenge !== issued.codeChallenge) {
            return json(400, { error: 'invalid_grant', error_description: 'pkce' }, 'token')
          }
        }
        const accessToken = base64url(randomBytes(24))
        accessTokens.set(accessToken, { tenant })
        const now = Math.floor(Date.now() / 1000)
        const idToken = await new SignJWT({
          ...claimsFor(tenant),
          ...(issued.nonce ? { nonce: issued.nonce } : {}),
        })
          .setProtectedHeader({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' })
          .setIssuer(issuer)
          .setAudience(issued.clientId)
          .setSubject(String(claimsFor(tenant).sub))
          .setIssuedAt(now)
          .setExpirationTime(now + 3600)
          .sign(script.badSignature ? strayKey : privateKey)
        return json(
          200,
          {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: issued.scope,
            id_token: idToken,
          },
          'token'
        )
      }

      if (sub === '/userinfo') {
        const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
        const grant = accessTokens.get(bearer)
        if (!grant || grant.tenant !== tenant)
          return json(401, { error: 'invalid_token' }, 'userinfo')
        return json(200, claimsFor(tenant), 'userinfo')
      }

      return json(404, { error: 'not found' }, 'unknown')
    }
  )

  const control = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (url.pathname === '/__oidc/health') return send(200, { ok: true })
    const tenantMatch = /^\/__oidc\/tenants\/([A-Za-z0-9._-]{4,})$/.exec(url.pathname)
    if (tenantMatch && req.method === 'POST') {
      const script = JSON.parse((await readBody(req)) || '{}') as FakeOidcScript
      scripts.set(tenantMatch[1], script)
      return send(200, { ok: true })
    }
    if (url.pathname === '/__oidc/requests' && req.method === 'GET') {
      const tenant = url.searchParams.get('tenant')
      return send(
        200,
        requests.filter((r) => !tenant || r.tenant === tenant)
      )
    }
    send(404, { error: 'not found' })
  })

  provider.listen({ port: env.oidcFakePort, host: '::', ipv6Only: false })
  control.listen(env.oidcFakeControlPort, '127.0.0.1')
  process.stdout.write(
    `OIDC fake listening on ${origin} (control http://127.0.0.1:${env.oidcFakeControlPort})\n`
  )
}
