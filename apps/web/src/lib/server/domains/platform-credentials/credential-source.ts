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
      console.error(
        `[PlatformCredentials] Failed to decrypt credentials for ${integrationType}:`,
        error
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

/** INTEGRATION_<TYPE>_  — e.g. 'azure-devops' -> 'INTEGRATION_AZURE_DEVOPS_'. */
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

/**
 * Managed-cloud source: shared OAuth-app credentials from
 * INTEGRATION_<PROVIDER>_<FIELD> env (projected from OpenBao via ESO).
 *
 * `env` and `knownTypes` are injectable for testing; in production they default to
 * process.env and the integration registry's type list.
 */
export class EnvCredentialSource implements CredentialSource {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly knownTypes: () => Promise<string[]> = defaultKnownTypes
  ) {}

  private read(integrationType: string): Record<string, string> {
    const prefix = envPrefix(integrationType)
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(this.env)) {
      if (value && key.startsWith(prefix) && key.length > prefix.length) {
        out[fieldFromEnvKey(prefix, key)] = value
      }
    }
    return out
  }

  async get(integrationType: string): Promise<Record<string, string> | null> {
    const creds = this.read(integrationType)
    return Object.keys(creds).length > 0 ? creds : null
  }

  async has(integrationType: string): Promise<boolean> {
    return Object.keys(this.read(integrationType)).length > 0
  }

  async listConfigured(): Promise<string[]> {
    const types = await this.knownTypes()
    return types.filter((t) => Object.keys(this.read(t)).length > 0)
  }
}
