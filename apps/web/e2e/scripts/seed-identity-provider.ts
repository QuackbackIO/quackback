/**
 * CLI: seed or remove an `identity_provider` row (+ its encrypted client
 * credential and an optional verified domain) for the identity-providers e2e.
 *
 * settings.* columns are JSON text; the provider model lives in the
 * `identity_provider`, `sso_verified_domain`, and `integration_platform_credentials`
 * tables. We write raw SQL (same style as the other e2e scripts) and generate
 * TypeIDs via `@quackback/ids` (the column default is a JS-level drizzle default
 * that a raw insert wouldn't trigger).
 *
 * The client secret is encrypted with the SAME AES-256-GCM + HKDF scheme as the
 * app's `encryptPlatformCredentials` (purpose `integration-platform-credentials`)
 * and stored at integration_type `auth_<registrationId>`, so the provider
 * satisfies the runtime registration gate (enabled + creds + tier). The
 * registration/routing/button gates only check that the credential ROW exists
 * (no decrypt), so the secret never needs to round-trip — but encrypting it
 * properly keeps the row indistinguishable from an app-written one.
 *
 * Usage:
 *   bun seed-identity-provider.ts seed '<json>'
 *   bun seed-identity-provider.ts remove <registrationId>
 *
 * seed JSON: {
 *   registrationId, label, clientId,
 *   discoveryUrl?, enabled?=true, showButton?=false, clientSecret?='e2e-secret',
 *   domain?: { name, verified?=true, enforced?=false }
 * }
 *
 * After mutating, the caller (access-helpers) drops the tenant-settings +
 * configured-types Redis caches so the running dev server sees the change.
 */
import postgres from 'postgres'
import { hkdfSync, randomBytes, createCipheriv, randomUUID } from 'crypto'
import { generateId, toUuid } from '@quackback/ids'

const action = (process.argv[2] || '').toLowerCase()
if (action !== 'seed' && action !== 'remove') {
  console.error("Usage: bun seed-identity-provider.ts <seed '<json>' | remove <registrationId>>")
  process.exit(1)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

/** Mirror of `encryptPlatformCredentials` (lib/server/integrations/encryption.ts):
 *  HKDF-SHA256(SECRET_KEY, salt, info) -> AES-256-GCM, format iv.tag.ct (base64url). */
function encryptPlatformCredentials(creds: Record<string, string>): string {
  const secretKey = process.env.SECRET_KEY
  if (!secretKey) throw new Error('SECRET_KEY environment variable is required')
  const info = 'quackback:v1:integration-platform-credentials'
  const key = Buffer.from(hkdfSync('sha256', secretKey, 'quackback-encryption-salt-v1', info, 32))
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  const ct = Buffer.concat([cipher.update(JSON.stringify(creds), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.')
}

interface SeedConfig {
  registrationId: string
  label: string
  clientId: string
  discoveryUrl?: string
  enabled?: boolean
  showButton?: boolean
  clientSecret?: string
  domain?: { name: string; verified?: boolean; enforced?: boolean }
}

const sql = postgres(connectionString)

async function remove(registrationId: string): Promise<void> {
  // Deleting the provider cascades its sso_verified_domain rows (FK on delete
  // cascade); the credential has no FK, so drop it explicitly.
  await sql`DELETE FROM identity_provider WHERE registration_id = ${registrationId}`
  await sql`DELETE FROM integration_platform_credentials WHERE integration_type = ${`auth_${registrationId}`}`
}

async function seed(cfg: SeedConfig): Promise<void> {
  // Idempotent: clear any prior row for this registrationId first.
  await remove(cfg.registrationId)

  const idpUuid = toUuid(generateId('identity_provider'))
  await sql`
    INSERT INTO identity_provider
      (id, registration_id, label, client_id, discovery_url, enabled, auto_create_users, show_button, created_at)
    VALUES
      (${idpUuid}, ${cfg.registrationId}, ${cfg.label}, ${cfg.clientId}, ${cfg.discoveryUrl ?? null},
       ${cfg.enabled ?? true}, true, ${cfg.showButton ?? false}, NOW())`

  const credUuid = toUuid(generateId('platform_cred'))
  const secrets = encryptPlatformCredentials({ clientSecret: cfg.clientSecret ?? 'e2e-secret' })
  await sql`
    INSERT INTO integration_platform_credentials (id, integration_type, secrets, created_at, updated_at)
    VALUES (${credUuid}, ${`auth_${cfg.registrationId}`}, ${secrets}, NOW(), NOW())`

  if (cfg.domain) {
    const domUuid = toUuid(generateId('domain'))
    const verifiedAt = cfg.domain.verified === false ? null : new Date()
    await sql`
      INSERT INTO sso_verified_domain
        (id, name, verification_token, verified_at, enforced, provider_id, created_at)
      VALUES
        (${domUuid}, ${cfg.domain.name}, ${`e2e-${randomUUID()}`}, ${verifiedAt},
         ${cfg.domain.enforced ?? false}, ${idpUuid}, NOW())`
  }
}

try {
  if (action === 'remove') {
    const registrationId = process.argv[3]
    if (!registrationId) throw new Error('remove requires a <registrationId>')
    await remove(registrationId)
    console.log(JSON.stringify({ action: 'remove', registrationId }))
  } else {
    const raw = process.argv[3]
    if (!raw) throw new Error("seed requires a '<json>' config")
    const cfg = JSON.parse(raw) as SeedConfig
    if (!cfg.registrationId || !cfg.label || !cfg.clientId) {
      throw new Error('seed config requires registrationId, label, clientId')
    }
    await seed(cfg)
    console.log(JSON.stringify({ action: 'seed', registrationId: cfg.registrationId }))
  }
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
