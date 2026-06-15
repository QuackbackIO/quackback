/**
 * Credential sources for platform (OAuth-app) credentials.
 *
 * - DbCredentialSource (self-host, default): reads the
 *   integration_platform_credentials table (admin-managed via the settings UI).
 *   Self-hosters own their own OAuth apps and paste their own credentials.
 * - EnvCredentialSource (managed cloud): reads shared OAuth-app credentials from
 *   INTEGRATION_<PROVIDER>_<FIELD> env, projected from OpenBao via ESO — exactly
 *   like the control plane consumes its own STRIPE_SECRET_KEY / GOOGLE_CLIENT_SECRET.
 *
 * The active source is selected by config.platformCredentialsSource. Provider
 * modules are unaffected: they still receive an injected credentials object; only
 * where that object comes from changes.
 */
import { db, integrationPlatformCredentials, eq } from '@/lib/server/db'
import { decryptPlatformCredentials } from '@/lib/server/integrations/encryption'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'platform-credentials' })

export interface CredentialSource {
  /** Decrypted credentials for a type, or null if not configured. */
  get(integrationType: string): Promise<Record<string, string> | null>
  /** Lightweight presence check (no decryption). */
  has(integrationType: string): Promise<boolean>
  /** The integration types that currently have credentials configured. */
  listConfigured(): Promise<string[]>
}

/** Self-host source: the per-instance integration_platform_credentials table. */
export class DbCredentialSource implements CredentialSource {
  async get(integrationType: string): Promise<Record<string, string> | null> {
    const row = await db.query.integrationPlatformCredentials.findFirst({
      where: eq(integrationPlatformCredentials.integrationType, integrationType),
      columns: { secrets: true },
    })
    if (!row) return null
    try {
      return decryptPlatformCredentials<Record<string, string>>(row.secrets)
    } catch (error) {
      log.error(
        { integration_type: integrationType, err: error },
        'failed to decrypt platform credentials'
      )
      return null
    }
  }

  async has(integrationType: string): Promise<boolean> {
    const row = await db.query.integrationPlatformCredentials.findFirst({
      where: eq(integrationPlatformCredentials.integrationType, integrationType),
      columns: { id: true },
    })
    return !!row
  }

  async listConfigured(): Promise<string[]> {
    const rows = await db.query.integrationPlatformCredentials.findMany({
      columns: { integrationType: true },
    })
    return rows.map((r) => r.integrationType)
  }
}

const ENV_PREFIX = 'INTEGRATION_'

/** INTEGRATION_<TYPE>_  — e.g. 'azure_devops' -> 'INTEGRATION_AZURE_DEVOPS_'. Any hyphen in an id is normalized to '_'. */
function envPrefix(integrationType: string): string {
  return `${ENV_PREFIX}${integrationType.toUpperCase().replace(/-/g, '_')}_`
}

/** 'CLIENT_SECRET' -> 'clientSecret' (the field name the provider modules expect). */
function fieldFromEnvKey(prefix: string, key: string): string {
  return key
    .slice(prefix.length)
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

async function defaultKnownTypes(): Promise<string[]> {
  const { listIntegrationTypes } = await import('@/lib/server/integrations')
  return listIntegrationTypes()
}

/** The platform-credential field keys a provider declares (all are required). */
async function defaultRequiredFields(integrationType: string): Promise<string[]> {
  const mod = await import('@/lib/server/integrations')
  return mod.getIntegration?.(integrationType)?.platformCredentials?.map((f) => f.key) ?? []
}

/**
 * Managed-cloud source: shared OAuth-app credentials from
 * INTEGRATION_<PROVIDER>_<FIELD> env (projected from OpenBao via ESO).
 *
 * Reports an integration as configured only when EVERY field the provider declares
 * in `platformCredentials` is present (fail closed) — matching the DB write
 * validation in functions/platform-credentials.ts. This prevents a partially
 * populated OpenBao path from looking configured and then failing mid-OAuth (e.g.
 * clientId present but clientSecret/signingSecret missing).
 *
 * `env`, `knownTypes` and `requiredFields` are injectable for testing; in production
 * they default to process.env and the integration registry.
 */
export class EnvCredentialSource implements CredentialSource {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly knownTypes: () => Promise<string[]> = defaultKnownTypes,
    private readonly requiredFields: (type: string) => Promise<string[]> = defaultRequiredFields
  ) {}

  private read(integrationType: string): Record<string, string> {
    const prefix = envPrefix(integrationType)
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(this.env)) {
      // Trim to match the DB write validation (functions/platform-credentials.ts
      // stores value.trim()), so a whitespace-only var counts as absent.
      const v = value?.trim()
      if (v && key.startsWith(prefix) && key.length > prefix.length) {
        out[fieldFromEnvKey(prefix, key)] = v
      }
    }
    return out
  }

  /** The creds for a type, or null unless every declared field is present (fail closed). */
  private async complete(integrationType: string): Promise<Record<string, string> | null> {
    const required = await this.requiredFields(integrationType)
    // A provider that declares no platform-credential fields is not configurable via
    // env — return null rather than reporting it configured off a stray INTEGRATION_* var.
    if (required.length === 0) return null
    const creds = this.read(integrationType)
    // Return ONLY the declared fields (like the DB save path, which strips extras), so
    // an undeclared INTEGRATION_<TYPE>_* var can never leak through the masked admin API.
    const out: Record<string, string> = {}
    for (const key of required) {
      if (!creds[key]) return null
      out[key] = creds[key]
    }
    return out
  }

  async get(integrationType: string): Promise<Record<string, string> | null> {
    return this.complete(integrationType)
  }

  async has(integrationType: string): Promise<boolean> {
    return (await this.complete(integrationType)) !== null
  }

  async listConfigured(): Promise<string[]> {
    const types = await this.knownTypes()
    const out: string[] = []
    for (const t of types) {
      if (await this.complete(t)) out.push(t)
    }
    return out
  }
}
