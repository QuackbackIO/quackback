/**
 * CLI: mint a widget identity (ssoToken) for a customer of the test's own
 * choosing, signed with the workspace's widget secret, so a test can be a
 * unique identified widget visitor. Prints the token.
 *
 * Usage: bun support-widget-token.ts '<json { id, email, name }>'
 */
import { createWidgetIdentityToken } from '@/lib/server/widget/identity-token'
import { ensureWidgetSecret } from '@/lib/server/domains/settings/settings.widget'

try {
  const claims = JSON.parse(process.argv[2] ?? '{}') as { id: string; email: string; name: string }
  if (!claims.id || !claims.email) throw new Error('id and email are required')
  const secret = await ensureWidgetSecret()
  process.stdout.write(createWidgetIdentityToken(claims, secret, 60 * 60))
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
