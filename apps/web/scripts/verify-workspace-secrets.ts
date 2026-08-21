/**
 * Prove a workspace's secrets resolve **from this process**, whatever process this
 * is.
 *
 *   bun run apps/web/scripts/verify-workspace-secrets.ts <hostname> [<hostname> …]
 *
 * The point is the environment it is run in, not the code it runs. Run it under
 * `env -i` with nothing but the fleet-level variables:
 *
 *   env -i PATH=$PATH \
 *     QUACKBACK_TENANCY=pooled \
 *     QUACKBACK_CONTROL_DATABASE_URL=… \
 *     QUACKBACK_FLEET_ROOT_KEY=… \
 *     SECRET_KEY=… BASE_URL=… \
 *     bun run apps/web/scripts/verify-workspace-secrets.ts a.example b.example
 *
 * Nothing workspace-specific is present. If the workspace's `SECRET_KEY` and storage
 * credentials come out anyway, custody is a property of the fleet rather than of
 * the machine that provisioned it — which is the whole claim, and the one an
 * earlier revision of the database credential failed silently.
 *
 * Read-only. It resolves, opens the canary the control plane wrote, and reports.
 * It never writes and never prints a secret.
 */
import { createHash } from 'node:crypto'
import postgres from 'postgres'
import { resolveWorkspaceByHostname } from '@/lib/server/workspaces/registry'
import { resolveWorkspacePassword } from '@/lib/server/workspaces/pool-cache'
import { resolveWorkspaceSecrets } from '@/lib/server/workspaces/workspace-secrets'
import { redactRef, withPassword } from '@/lib/server/workspaces/vendor/secret-ref'
import { verifySecretKeyCanary } from '@/lib/server/workspaces/vendor/fleet-secrets'

/** A stable, non-reversible tag. Two processes agreeing on it agree on the key. */
function tag(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

const hostnames = process.argv.slice(2)
if (hostnames.length === 0) {
  console.error('usage: verify-workspace-secrets.ts <hostname> [<hostname> …]')
  process.exit(2)
}

let failed = false

for (const hostname of hostnames) {
  const lookup = await resolveWorkspaceByHostname(hostname)
  if (lookup.kind !== 'ok') {
    console.error(`✖ ${hostname} → ${lookup.kind}`)
    failed = true
    continue
  }
  const workspace = lookup.workspace
  console.log(`\n${hostname} → ${workspace.workspaceKey} (revision ${workspace.revision})`)
  console.log(`  appSecretsRef   ${workspace.secrets.appSecretsRef}`)
  console.log(`  storageRef      ${redactRef(workspace.storage.credentialRef)}`)

  let secrets
  try {
    secrets = await resolveWorkspaceSecrets(workspace)
  } catch (err) {
    console.error(`  ✖ SECRET_KEY unresolvable: ${(err as Error).message}`)
    failed = true
    continue
  }

  console.log(`  SECRET_KEY      resolved, sha256[0:12]=${tag(secrets.secretKey)}`)
  if (secrets.storage) {
    console.log(
      `  storage keys    resolved, accessKeyId sha256[0:12]=${tag(secrets.storage.accessKeyId)}`
    )
    console.log(`                  bucket ${workspace.storage.bucket}`)
  } else {
    console.log(`  storage keys    UNRESOLVED — ${secrets.storageProblem}`)
    failed = true
  }

  // The canary the control plane wrote is the only thing that says this key is
  // the key this database's ciphertext was written under.
  let password: string
  try {
    password = await resolveWorkspacePassword(workspace)
  } catch (err) {
    console.log(
      `  canary          skipped — ${(err as Error).message || 'no database credential resolver for this ref'}`
    )
    continue
  }
  if (!password) {
    console.log('  canary          skipped — no database credential resolver for this ref')
    continue
  }
  const sql = postgres(withPassword(workspace.database.directUrl, password), {
    max: 1,
    idle_timeout: 5,
    onnotice: () => {},
  })
  try {
    const rows = (await sql`
      SELECT (to_jsonb(s) ->> 'cloud_secret_canary') AS canary FROM settings s LIMIT 1
    `) as unknown as Array<{ canary: string | null }>
    const canary = rows[0]?.canary ?? null
    const ok =
      canary !== null && verifySecretKeyCanary(secrets.secretKey, workspace.workspaceKey, canary)
    console.log(`  canary          ${ok ? 'OPENS with the resolved key' : 'DOES NOT OPEN'}`)
    if (!ok) failed = true
  } finally {
    await sql.end({ timeout: 5 })
  }
}

console.log(failed ? '\nFAILED' : '\nOK')
process.exit(failed ? 1 : 0)
