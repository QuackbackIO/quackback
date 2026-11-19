/**
 * CLI: sign an MCP OAuth access token for a person with the app's own JWT
 * keys (the same signer the authorization server uses), so the MCP specs can
 * call /api/mcp as a human OAuth client without a browser consent flow. The
 * claims mirror what the MCP authorization server puts in its tokens
 * (auth/index.ts customAccessTokenClaims): principalId, role, name, email,
 * scope, audience /api/mcp, issuer /api/auth.
 *
 * Usage: bun support-mcp-token.ts '<json { email, scopes: string[] }>'
 */
import { db, eq, principal, user } from '@/lib/server/db'
import { getAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'

try {
  const { email, scopes } = JSON.parse(process.argv[2] ?? '{}') as {
    email: string
    scopes: string[]
  }
  const [row] = await db
    .select({ userId: user.id, name: user.name, principalId: principal.id, role: principal.role })
    .from(user)
    .innerJoin(principal, eq(principal.userId, user.id))
    .where(eq(user.email, email))
    .limit(1)
  if (!row) throw new Error(`No user ${email}`)
  const auth = await getAuth()
  const now = Math.floor(Date.now() / 1000)
  const signed = (await (
    auth.api as unknown as {
      signJWT: (input: { body: { payload: Record<string, unknown> } }) => Promise<{ token: string }>
    }
  ).signJWT({
    body: {
      payload: {
        sub: row.userId,
        iss: `${config.baseUrl}/api/auth`,
        aud: `${config.baseUrl}/api/mcp`,
        azp: 'e2e-mcp-client',
        iat: now,
        exp: now + 600,
        scope: scopes.join(' '),
        principalId: row.principalId,
        role: row.role,
        name: row.name,
        email,
      },
    },
  })) as { token: string }
  process.stdout.write(signed.token)
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
